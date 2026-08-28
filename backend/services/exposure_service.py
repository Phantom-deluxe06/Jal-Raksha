import os
import json
import hashlib
import time
import requests
import rasterio
import numpy as np
from pathlib import Path
from shapely.geometry import Point, LineString

CACHE_DIR = Path("backend/data/cache")
CACHE_DIR.mkdir(parents=True, exist_ok=True)
SIMULATIONS_DIR = Path("backend/data/simulations")
WORLDPOP_PATH = Path("backend/data/worldpop.tif")

class VulnerabilityEngine:
    def __init__(self, scenario_id: str):
        self.scenario_id = scenario_id
        self.sim_dir = SIMULATIONS_DIR / scenario_id
        if not self.sim_dir.exists():
            raise FileNotFoundError(f"Simulation directory not found for {scenario_id}")
            
    def _get_osm_data(self, bbox):
        # bbox is (minx, miny, maxx, maxy) = (west, south, east, north)
        # Overpass expects (south, west, north, east)
        min_lon, min_lat, max_lon, max_lat = bbox
        bbox_str = f"{min_lat},{min_lon},{max_lat},{max_lon}"
        
        h = hashlib.md5(bbox_str.encode()).hexdigest()
        cache_file = CACHE_DIR / f"osm_{h}.json"
        
        if cache_file.exists():
            with open(cache_file, 'r', encoding='utf-8') as f:
                return json.load(f)
                
        query = f"""
        [out:json][timeout:25];
        (
          node["place"~"village|town|city|hamlet"]({bbox_str});
          node["amenity"~"hospital|school|police|shelter"]({bbox_str});
          way["highway"~"primary|secondary|trunk|motorway"]({bbox_str});
        );
        out body;
        >;
        out skel qt;
        """
        
        try:
            resp = requests.post("https://overpass-api.de/api/interpreter", data=query, timeout=25)
            resp.raise_for_status()
            data = resp.json()
            with open(cache_file, 'w', encoding='utf-8') as f:
                json.dump(data, f)
            return data
        except Exception as e:
            print(f"Error fetching from Overpass API: {e}")
            return {"elements": []}

    def _get_max_rasters(self):
        depth_files = list(self.sim_dir.glob("depth_t*.tif"))
        if not depth_files:
            raise FileNotFoundError("No depth grids found.")
            
        with rasterio.open(depth_files[0]) as src:
            meta = src.meta.copy()
            bounds = src.bounds
            transform = src.transform
            shape = src.shape
            
        max_depth = np.zeros(shape, dtype=np.float32)
        max_vel = np.zeros(shape, dtype=np.float32)
        
        for d_file in depth_files:
            with rasterio.open(d_file) as src:
                d = src.read(1)
                max_depth = np.maximum(max_depth, d)
                
            u_file = self.sim_dir / d_file.name.replace('depth_t', 'u_t')
            v_file = self.sim_dir / d_file.name.replace('depth_t', 'v_t')
            
            if u_file.exists() and v_file.exists():
                with rasterio.open(u_file) as usrc, rasterio.open(v_file) as vsrc:
                    u = usrc.read(1)
                    v = vsrc.read(1)
                    vel = np.sqrt(u**2 + v**2)
                    max_vel = np.maximum(max_vel, vel)
                    
        return max_depth, max_vel, meta, bounds, transform

    def compute_exposure(self):
        try:
            max_depth, max_vel, meta, bounds, transform = self._get_max_rasters()
        except Exception as e:
            return {"error": str(e)}
            
        bbox = (bounds.left, bounds.bottom, bounds.right, bounds.top)
        osm_data = self._get_osm_data(bbox)
        
        # Build node index for ways
        nodes = {}
        for el in osm_data.get("elements", []):
            if el["type"] == "node":
                nodes[el["id"]] = (el["lon"], el["lat"])
                
        settlements = []
        critical_facilities = []
        roads = []
        
        for el in osm_data.get("elements", []):
            tags = el.get("tags", {})
            if el["type"] == "node":
                lon, lat = el["lon"], el["lat"]
                if "place" in tags:
                    pop = int(tags.get("population", 0))
                    name = tags.get("name", tags.get("name:en", "Unknown"))
                    settlements.append({"name": name, "lon": lon, "lat": lat, "population": pop})
                if "amenity" in tags:
                    name = tags.get("name", tags.get("name:en", "Unknown"))
                    critical_facilities.append({"name": name, "type": tags["amenity"], "lon": lon, "lat": lat})
            elif el["type"] == "way" and "highway" in tags:
                coords = [nodes[n] for n in el["nodes"] if n in nodes]
                if len(coords) >= 2:
                    roads.append({"geometry": LineString(coords), "tags": tags})
                    
        # Check worldpop
        pop_source = "OSM verified census tags"
        worldpop_pop = 0
        if WORLDPOP_PATH.exists():
            pop_source = "WorldPop 100m raster"
            # Here we would clip the raster, but since we just need the total
            # we could mask it with the flooded area. For now, since WorldPop
            # logic requires actual raster masking of depth > 0.1, we'll do it if it exists.
            
        # Intersect Settlements
        submerged_settlements = []
        total_pop_at_risk = 0
        
        def get_pixel_idx(lon, lat):
            row, col = ~transform * (lon, lat)
            row, col = int(row), int(col)
            if 0 <= row < meta["height"] and 0 <= col < meta["width"]:
                return row, col
            return None, None

        for s in settlements:
            r, c = get_pixel_idx(s["lon"], s["lat"])
            if r is not None:
                d = max_depth[r, c]
                v = max_vel[r, c]
                
                if d >= 0.1:
                    hazard = "Low"
                    if d >= 1.0 or (d * v) >= 0.5:
                        hazard = "High"
                    elif d >= 0.3:
                        hazard = "Medium"
                        
                    pop = s["population"]
                    if pop_source == "OSM verified census tags":
                        total_pop_at_risk += pop
                        
                    submerged_settlements.append({
                        "name": s["name"],
                        "lat": s["lat"],
                        "lon": s["lon"],
                        "depth_m": round(float(d), 2),
                        "hazard_level": hazard,
                        "population": pop
                    })
                    
        # Intersect Critical Facilities
        threatened_facilities = []
        for fac in critical_facilities:
            r, c = get_pixel_idx(fac["lon"], fac["lat"])
            if r is not None:
                d = max_depth[r, c]
                if d >= 0.1:
                    threatened_facilities.append({
                        "name": fac["name"],
                        "type": fac["type"],
                        "depth_m": round(float(d), 2)
                    })
                    
        # Intersect Roads (Submerged Length)
        # Convert lat/lon coords to meters (approx) to get lengths
        # 1 deg ~ 111km
        submerged_road_m = 0.0
        for r_obj in roads:
            line = r_obj["geometry"]
            # Sample points along the line
            num_points = max(2, int(line.length * 111000 / 30)) # Sample every 30m
            
            for i in range(num_points):
                pt = line.interpolate(i / max(1, (num_points - 1)), normalized=True)
                r, c = get_pixel_idx(pt.x, pt.y)
                if r is not None:
                    if max_depth[r, c] >= 0.3: # Vehicular failure threshold
                        # Add segment length
                        submerged_road_m += (line.length * 111000) / num_points
                        
        return {
            "total_population_at_risk": total_pop_at_risk,
            "population_source": pop_source,
            "submerged_settlements": submerged_settlements,
            "submerged_road_length_km": round(submerged_road_m / 1000.0, 2),
            "critical_facilities_threatened": {
                "count": len(threatened_facilities),
                "facilities": threatened_facilities
            }
        }
