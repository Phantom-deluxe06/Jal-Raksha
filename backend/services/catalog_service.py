import os
from pathlib import Path
from typing import List, Dict, Any, Optional

try:
    import geopandas as gpd
    from shapely.geometry import Point
    HAS_GPD = True
except ImportError:
    HAS_GPD = False

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
DAMS_FILE = DATA_DIR / "catalog" / "nrld_dams.geojson"
RIVERS_FILE = DATA_DIR / "catalog" / "hydrorivers_india.gpkg"

# Fallback Benchmark Presets
PRESET_DAMS = [
    {
        "dam_id": "IN_CWC_062_001",
        "name": "Kosi Barrage",
        "river": "Kosi",
        "state": "Bihar",
        "district": "Supaul",
        "lat": 26.520,
        "lon": 86.920,
        "height_m": 12.5,
        "storage_mcm": 150.0,
        "spillway_capacity_cumec": 27000.0,
        "nearest_gauge_id": "062-MGD4PTN",
        "is_preset": True,
    },
    {
        "dam_id": "IN_CWC_KL_002",
        "name": "Mullaperiyar Dam",
        "river": "Periyar",
        "state": "Kerala",
        "district": "Idukki",
        "lat": 9.528,
        "lon": 77.146,
        "height_m": 53.6,
        "storage_mcm": 443.23,
        "spillway_capacity_cumec": 3450.0,
        "nearest_gauge_id": "KL-PER-01",
        "is_preset": True,
    },
    {
        "dam_id": "IN_CWC_KL_003",
        "name": "Idukki Arch Dam",
        "river": "Periyar",
        "state": "Kerala",
        "district": "Idukki",
        "lat": 9.843,
        "lon": 76.976,
        "height_m": 168.91,
        "storage_mcm": 1996.0,
        "spillway_capacity_cumec": 3398.0,
        "nearest_gauge_id": "KL-PER-02",
        "is_preset": True,
    },
    {
        "dam_id": "IN_CWC_UK_004",
        "name": "Tehri Dam",
        "river": "Bhagirathi",
        "state": "Uttarakhand",
        "district": "Tehri Garhwal",
        "lat": 30.378,
        "lon": 78.480,
        "height_m": 260.5,
        "storage_mcm": 3540.0,
        "spillway_capacity_cumec": 15540.0,
        "nearest_gauge_id": "UK-BHA-01",
        "is_preset": True,
    },
    {
        "dam_id": "IN_CWC_UK_005",
        "name": "Rishi Ganga Catchment",
        "river": "Rishi Ganga",
        "state": "Uttarakhand",
        "district": "Chamoli",
        "lat": 30.419,
        "lon": 79.697,
        "height_m": 0.0,
        "storage_mcm": 0.0,
        "spillway_capacity_cumec": 0.0,
        "nearest_gauge_id": "UK-RISHI-01",
        "is_preset": True,
    },
]


class CatalogService:
    def __init__(self):
        self.dams_gdf = None
        self.rivers_gdf = None
        self.dams_list = []
        self._load_data()

    def _load_data(self):
        if HAS_GPD and DAMS_FILE.exists():
            try:
                self.dams_gdf = gpd.read_file(DAMS_FILE)
                # Convert to simple list for fast non-spatial filtering
                self.dams_list = self.dams_gdf.to_dict("records")
            except Exception as e:
                print(f"[CatalogService] Error loading dams file: {e}")
                self.dams_list = PRESET_DAMS
        else:
            self.dams_list = PRESET_DAMS

        if HAS_GPD and RIVERS_FILE.exists():
            try:
                self.rivers_gdf = gpd.read_file(RIVERS_FILE)
            except Exception as e:
                print(f"[CatalogService] Error loading rivers file: {e}")

    def search_dams(self, query: str = "", state: str = "", limit: int = 50) -> List[Dict[str, Any]]:
        results = []
        q = query.lower() if query else ""
        s = state.lower() if state else ""
        
        for dam in self.dams_list:
            d_name = str(dam.get("name", "")).lower()
            d_river = str(dam.get("river", "")).lower()
            d_state = str(dam.get("state", "")).lower()
            
            if q and not (q in d_name or q in d_river):
                continue
            if s and s not in d_state:
                continue
            
            results.append(dam)
            if len(results) >= limit:
                break
        
        return results

    def get_dam(self, dam_id: str) -> Optional[Dict[str, Any]]:
        for dam in self.dams_list:
            if dam.get("dam_id") == dam_id:
                return dam
        return None

    def get_downstream_aoi(self, dam_id: str, buffer_km: float = 30.0) -> Dict[str, Any]:
        dam = self.get_dam(dam_id)
        if not dam:
            return None
        
        lat = dam.get("lat")
        lon = dam.get("lon")
        
        if not lat or not lon:
            return None

        # Approximate 1 degree ~ 111 km
        buffer_deg = buffer_km / 111.0
        
        bounds = {
            "west": lon - buffer_deg,
            "south": lat - buffer_deg,
            "east": lon + buffer_deg,
            "north": lat + buffer_deg
        }
        
        # If we had loaded the rivers_gdf and had proper tracing logic, we'd trace downstream flow lines here.
        # But this bounding box buffer approach guarantees a bounding box in O(1) as a robust fallback.
        
        return {
            "dam_id": dam_id,
            "bounds": bounds,
            "buffer_km": buffer_km,
            "geojson": {
                "type": "Polygon",
                "coordinates": [[
                    [bounds["west"], bounds["north"]],
                    [bounds["east"], bounds["north"]],
                    [bounds["east"], bounds["south"]],
                    [bounds["west"], bounds["south"]],
                    [bounds["west"], bounds["north"]]
                ]]
            }
        }

    def search_rivers(self, name: str = "", limit: int = 20) -> List[Dict[str, Any]]:
        # If we don't have rivers loaded, return empty list
        if self.rivers_gdf is None or not name:
            return []
        
        q = name.lower()
        # This assumes the HydroRIVERS data has a 'RIV_NAME' column or similar
        # For generalization, let's just do a naive search if column exists
        col = 'RIV_NAME'
        if col not in self.rivers_gdf.columns:
            # Maybe it's called 'name'
            col = 'name' if 'name' in self.rivers_gdf.columns else None
            
        if not col:
            return []
            
        matches = self.rivers_gdf[self.rivers_gdf[col].str.lower().str.contains(q, na=False)].head(limit)
        
        # Convert to a simple structure (not dumping huge geometry if not requested)
        records = matches.drop(columns=['geometry']).to_dict("records")
        return records

catalog_service = CatalogService()
