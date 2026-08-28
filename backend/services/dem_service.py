import os
import math
import numpy as np
import rasterio
from rasterio.merge import merge
from rasterio.mask import mask
from rasterio.enums import Resampling
from rasterio.transform import from_bounds
from rasterio.io import MemoryFile
from pathlib import Path
from shapely.geometry import box
import base64
from io import BytesIO
from PIL import Image

CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "cache"
os.makedirs(CACHE_DIR, exist_ok=True)

class DEMIngestionEngine:
    def __init__(self):
        self.base_url = "s3://copernicus-dem-30m"
        self.env = rasterio.Env(AWS_NO_SIGN_REQUEST='YES', VSI_CACHE=True)

    def _get_tile_name(self, lat: int, lon: int) -> str:
        """Copernicus GLO-30 specific tile naming convention."""
        ns = "N" if lat >= 0 else "S"
        ew = "E" if lon >= 0 else "W"
        return f"Copernicus_DSM_COG_10_{ns}{abs(lat):02d}_00_{ew}{abs(lon):03d}_00_DEM"

    def fetch_aoi(self, dam_id: str, bbox: list, target_resolution_m: float = 90.0) -> dict:
        """
        Fetches, merges, clips, and resamples Copernicus DEM tiles for a given bounding box.
        bbox = [west, south, east, north]
        """
        min_lon, min_lat, max_lon, max_lat = bbox
        
        # Calculate intersecting 1-degree tiles
        min_lon_int = math.floor(min_lon)
        max_lon_int = math.floor(max_lon)
        min_lat_int = math.floor(min_lat)
        max_lat_int = math.floor(max_lat)
        
        tiles = []
        for lat in range(min_lat_int, max_lat_int + 1):
            for lon in range(min_lon_int, max_lon_int + 1):
                tile_name = self._get_tile_name(lat, lon)
                tile_url = f"{self.base_url}/{tile_name}/{tile_name}.tif"
                tiles.append(tile_url)
                
        # Target raster cache path
        res_deg = target_resolution_m / 111000.0  # Approx meters to degrees
        cache_file = CACHE_DIR / f"dem_{dam_id}_{target_resolution_m}m.tif"
        png_cache_file = CACHE_DIR / f"dem_{dam_id}_{target_resolution_m}m.png"

        try:
            if not cache_file.exists():
                src_files_to_mosaic = []
                with self.env:
                    for tile in tiles:
                        try:
                            src = rasterio.open(tile)
                            src_files_to_mosaic.append(src)
                        except Exception as e:
                            print(f"[DEMIngestionEngine] Warning: Could not open tile {tile}: {e}")
                    
                    if not src_files_to_mosaic:
                        raise ValueError("No valid DEM tiles found for the given bounding box.")
                    
                    # Merge tiles
                    mosaic, out_trans = merge(src_files_to_mosaic)
                    
                    # Create in-memory dataset of the mosaic to mask it
                    out_meta = src_files_to_mosaic[0].meta.copy()
                    out_meta.update({
                        "driver": "GTiff",
                        "height": mosaic.shape[1],
                        "width": mosaic.shape[2],
                        "transform": out_trans,
                    })
                    
                    geom = box(min_lon, min_lat, max_lon, max_lat)
                    
                    with MemoryFile() as memfile:
                        with memfile.open(**out_meta) as mem_src:
                            mem_src.write(mosaic)
                        
                        with memfile.open() as mem_src2:
                            out_image, out_transform = mask(mem_src2, [geom], crop=True)
                            
                    # Resample to target resolution
                    # Compute new dimensions
                    width = int((max_lon - min_lon) / res_deg)
                    height = int((max_lat - min_lat) / res_deg)
                    
                    resampled_transform = from_bounds(min_lon, min_lat, max_lon, max_lat, width, height)
                    
                    final_meta = out_meta.copy()
                    final_meta.update({
                        "height": height,
                        "width": width,
                        "transform": resampled_transform
                    })
                    
                    resampled_image = np.empty(shape=(1, height, width), dtype=out_meta['dtype'])
                    
                    # Write to cache using reproject/resample logic provided by rasterio
                    from rasterio.warp import reproject, Resampling
                    reproject(
                        source=out_image,
                        destination=resampled_image,
                        src_transform=out_transform,
                        src_crs=out_meta['crs'],
                        dst_transform=resampled_transform,
                        dst_crs=out_meta['crs'],
                        resampling=Resampling.bilinear
                    )
                    
                    with rasterio.open(cache_file, "w", **final_meta) as dest:
                        dest.write(resampled_image)
                        
                    # Cleanup
                    for src in src_files_to_mosaic:
                        src.close()
                        
            # Generate or load stats and hillshade
            with rasterio.open(cache_file) as src:
                elev = src.read(1)
                
                # Filter out no-data (e.g., extremely low values if any)
                valid_elev = elev[elev > -500]
                min_elev = float(np.min(valid_elev)) if valid_elev.size > 0 else 0
                max_elev = float(np.max(valid_elev)) if valid_elev.size > 0 else 0
                
                # Approximate Slope
                dy, dx = np.gradient(elev, res_deg * 111000, res_deg * 111000 * math.cos(math.radians((min_lat+max_lat)/2)))
                slope = np.degrees(np.arctan(np.sqrt(dx*dx + dy*dy)))
                mean_slope = float(np.nanmean(slope))
                
                if not png_cache_file.exists():
                    self._generate_hillshade(elev, png_cache_file)

            return {
                "dam_id": dam_id,
                "status": "ready",
                "source": "Copernicus GLO-30",
                "grid_shape": [elev.shape[0], elev.shape[1]],
                "min_elevation_m": round(min_elev, 2),
                "max_elevation_m": round(max_elev, 2),
                "mean_slope_deg": round(mean_slope, 2),
                "raster_url": f"/api/dem/download/{dam_id}",
                "preview_png_url": f"/api/dem/preview/{dam_id}.png"
            }
            
        except Exception as e:
            print(f"[DEMIngestionEngine] Error fetching DEM: {e}")
            import traceback
            traceback.print_exc()
            return {
                "dam_id": dam_id,
                "status": "fallback_to_kosi",
                "error": str(e),
                "source": "Kosi Baseline Cache (Fallback)",
                "grid_shape": [435, 412],
                "min_elevation_m": 41.5,
                "max_elevation_m": 391.2,
                "mean_slope_deg": 1.4,
                "raster_url": "/api/dem/download/kosi_fallback",
                "preview_png_url": "/api/dem/preview/kosi_fallback.png"
            }

    def _generate_hillshade(self, elev: np.ndarray, out_path: Path):
        """Generates a hillshade PNG using numpy."""
        # Normalize elevation for colormapping (viridis-like or terrain)
        min_val, max_val = np.nanmin(elev), np.nanmax(elev)
        if max_val == min_val:
            max_val = min_val + 1
            
        # Basic Hillshade math
        azimuth = 315.0
        altitude = 45.0
        x, y = np.gradient(elev)
        slope = np.pi/2. - np.arctan(np.sqrt(x*x + y*y))
        aspect = np.arctan2(-x, y)
        azimuthrad = azimuth * np.pi/180.
        altituderad = altitude * np.pi/180.
        
        shaded = np.sin(altituderad)*np.sin(slope) + np.cos(altituderad)*np.cos(slope)*np.cos((azimuthrad - np.pi/2.) - aspect)
        shaded = 255 * (shaded + 1) / 2
        shaded = np.clip(shaded, 0, 255).astype(np.uint8)
        
        # Colorize (Terrain-like)
        # Using a simple custom colormap mapping: low=green, mid=yellow/brown, high=white
        norm = (elev - min_val) / (max_val - min_val)
        norm = np.clip(norm, 0, 1)
        
        r = np.interp(norm, [0, 0.5, 0.8, 1.0], [50, 200, 220, 255])
        g = np.interp(norm, [0, 0.5, 0.8, 1.0], [150, 180, 200, 255])
        b = np.interp(norm, [0, 0.5, 0.8, 1.0], [50, 100, 180, 255])
        
        # Blend with hillshade
        alpha = 0.5
        r_blend = (r * (1 - alpha) + shaded * alpha).astype(np.uint8)
        g_blend = (g * (1 - alpha) + shaded * alpha).astype(np.uint8)
        b_blend = (b * (1 - alpha) + shaded * alpha).astype(np.uint8)
        
        rgba = np.dstack((r_blend, g_blend, b_blend, np.full_like(r_blend, 255)))
        img = Image.fromarray(rgba, mode="RGBA")
        img.save(out_path, format="PNG")

dem_engine = DEMIngestionEngine()
