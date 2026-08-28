import os
import json
import zipfile
import rasterio
from rasterio.features import shapes
import geopandas as gpd
from shapely.geometry import shape
import simplekml
from pathlib import Path
import numpy as np

SIMULATIONS_DIR = Path("backend/data/simulations")

class GISExportEngine:
    def __init__(self, scenario_id: str):
        self.scenario_id = scenario_id
        self.sim_dir = SIMULATIONS_DIR / scenario_id
        if not self.sim_dir.exists():
            raise FileNotFoundError(f"Simulation directory not found for {scenario_id}")

    def _get_max_depth_raster(self):
        depth_files = list(self.sim_dir.glob("depth_t*.tif"))
        if not depth_files:
            raise FileNotFoundError("No depth grids found.")
            
        with rasterio.open(depth_files[0]) as src:
            meta = src.meta.copy()
            max_depth = np.zeros(src.shape, dtype=np.float32)
            
        for d_file in depth_files:
            with rasterio.open(d_file) as src:
                d = src.read(1)
                max_depth = np.maximum(max_depth, d)
                
        return max_depth, meta

    def _polygonize_hazard(self, max_depth, transform):
        # Discretize depth into bands
        # Low Hazard: 0.1 - 0.3 -> 1
        # Medium Hazard: 0.3 - 1.0 -> 2
        # High Hazard: > 1.0 -> 3
        categorized = np.zeros_like(max_depth, dtype=np.int32)
        categorized[(max_depth >= 0.1) & (max_depth < 0.3)] = 1
        categorized[(max_depth >= 0.3) & (max_depth < 1.0)] = 2
        categorized[max_depth >= 1.0] = 3
        
        mask = categorized > 0
        results = (
            {'properties': {'hazard_val': v, 'hazard_lvl': 'Low' if v==1 else ('Medium' if v==2 else 'High')}, 'geometry': s}
            for i, (s, v) 
            in enumerate(shapes(categorized, mask=mask, transform=transform))
        )
        
        geoms = list(results)
        if not geoms:
            # Return empty geodataframe
            return gpd.GeoDataFrame(columns=['hazard_val', 'hazard_lvl', 'geometry'], crs="EPSG:4326")
            
        gdf = gpd.GeoDataFrame.from_features(geoms, crs="EPSG:4326")
        return gdf

    def export_geojson(self, output_path: str):
        max_depth, meta = self._get_max_depth_raster()
        gdf = self._polygonize_hazard(max_depth, meta['transform'])
        gdf.to_file(output_path, driver="GeoJSON")
        return output_path

    def export_shapefile(self, output_zip_path: str):
        max_depth, meta = self._get_max_depth_raster()
        gdf = self._polygonize_hazard(max_depth, meta['transform'])
        
        tmp_dir = self.sim_dir / "tmp_shp"
        tmp_dir.mkdir(exist_ok=True)
        shp_path = tmp_dir / f"flood_extent_{self.scenario_id}.shp"
        
        gdf.to_file(shp_path, driver="ESRI Shapefile")
        
        # Zip the components
        with zipfile.ZipFile(output_zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for ext in ['.shp', '.shx', '.dbf', '.prj', '.cpg']:
                file_part = tmp_dir / f"flood_extent_{self.scenario_id}{ext}"
                if file_part.exists():
                    zipf.write(file_part, arcname=f"flood_extent_{self.scenario_id}{ext}")
                    
        # Cleanup
        for file in tmp_dir.glob("*"):
            file.unlink()
        tmp_dir.rmdir()
        
        return output_zip_path

    def export_kml(self, output_path: str):
        max_depth, meta = self._get_max_depth_raster()
        gdf = self._polygonize_hazard(max_depth, meta['transform'])
        
        kml = simplekml.Kml()
        
        # Colors: AABBGGRR (Alpha, Blue, Green, Red) in simplekml
        # Translucent Cyan for Low (1) -> e6ffff00
        # Translucent Orange for Medium (2) -> e600a5ff
        # Translucent Crimson for High (3) -> e63c14dc
        colors = {
            1: '99ffff00', # 60% opacity cyan
            2: '9900a5ff', # 60% opacity orange 
            3: '993c14dc'  # 60% opacity crimson
        }
        
        for idx, row in gdf.iterrows():
            geom = row.geometry
            if geom.geom_type == 'Polygon':
                polygons = [geom]
            elif geom.geom_type == 'MultiPolygon':
                polygons = geom.geoms
            else:
                continue
                
            for poly in polygons:
                # Kml polygon expects coords as (lon, lat)
                coords = list(poly.exterior.coords)
                pol = kml.newpolygon(name=row.hazard_lvl)
                pol.outerboundaryis = coords
                pol.style.polystyle.color = colors.get(row.hazard_val, '99ffffff')
                pol.style.linestyle.width = 0
                
        kml.save(output_path)
        return output_path
