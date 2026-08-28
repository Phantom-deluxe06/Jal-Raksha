import os
import json
import time
from typing import Tuple, Dict, Any
from datetime import datetime, timedelta

try:
    import ee
    HAS_EE = True
except ImportError:
    HAS_EE = False

class GeneralizedGEEService:
    def __init__(self):
        if not HAS_EE:
            raise RuntimeError("earthengine-api package is not installed.")
            
        # Try to authenticate/initialize
        try:
            # First try default environment initialization (relies on active gcloud or earthengine authenticate)
            ee.Initialize()
        except Exception as e:
            # Fallback to explicit service account if provided
            sa = os.environ.get("GEE_SERVICE_ACCOUNT")
            pk_json = os.environ.get("GEE_PRIVATE_KEY_JSON")
            if sa and pk_json:
                try:
                    credentials = ee.ServiceAccountCredentials(sa, key_data=pk_json)
                    ee.Initialize(credentials)
                except Exception as sa_err:
                    raise RuntimeError(f"GEE Initialization failed with Service Account: {sa_err}")
            else:
                raise RuntimeError(f"GEE Initialization failed. Please run 'earthengine authenticate' or provide GEE_SERVICE_ACCOUNT and GEE_PRIVATE_KEY_JSON. Error: {e}")

    def extract_flood_extent(
        self, 
        bbox: Tuple[float, float, float, float], 
        target_date: str, 
        lookback_days: int = 10, 
        threshold_db: float = -17.0
    ) -> Dict[str, Any]:
        
        start_time = time.time()
        
        min_lon, min_lat, max_lon, max_lat = bbox
        geometry = ee.Geometry.Rectangle([min_lon, min_lat, max_lon, max_lat])
        
        target = datetime.strptime(target_date, "%Y-%m-%d")
        start_date = (target - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
        end_date = (target + timedelta(days=3)).strftime("%Y-%m-%d")
        
        # 1. Fetch Sentinel-1 Collection
        s1 = (ee.ImageCollection('COPERNICUS/S1_GRD')
            .filterBounds(geometry)
            .filterDate(start_date, end_date)
            .filter(ee.Filter.eq('instrumentMode', 'IW'))
            .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
            .select('VV'))
            
        # Check if collection is empty
        count = s1.size().getInfo()
        if count == 0:
            raise ValueError(f"No Sentinel-1 IW VV imagery found between {start_date} and {end_date} for this bounding box.")
            
        # We take the closest image to target date or just the latest one in the range
        # Sorting by system:time_start
        s1_sorted = s1.sort('system:time_start', False)
        crisis_image = ee.Image(s1_sorted.first())
        
        # Apply smoothing to reduce speckle (focal median)
        smoothed = crisis_image.focal_median(50, 'circle', 'meters')
        
        # 2. Thresholding for water
        water_mask = smoothed.lt(threshold_db)
        
        # 3. Mask permanent water
        jrc = ee.Image('JRC/GSW1_4/GlobalSurfaceWater')
        seasonality = jrc.select('seasonality')
        # We want pixels where seasonality is low (< 10 months) or null (not permanent water)
        permanent_water = seasonality.gte(10).unmask(0)
        
        # 4. Mask steep slopes to prevent radar shadow misclassification
        dem = ee.Image('COPERNICUS/DEM/GLO30')
        slope = ee.Terrain.slope(dem)
        flat_areas = slope.lt(5)
        
        # Combine masks: must be water, NOT permanent water, AND flat
        transient_flood = water_mask.And(permanent_water.Not()).And(flat_areas).selfMask()
        
        # 5. Get Map Tile URL
        # We render in Orange/Gold palette: #FF9900
        map_id_dict = transient_flood.getMapId({
            'min': 1,
            'max': 1,
            'palette': ['FF9900']
        })
        tile_url = map_id_dict['tile_fetcher'].url_format
        
        # 6. Calculate Area
        # Area per pixel in square meters, convert to km2
        area_image = transient_flood.multiply(ee.Image.pixelArea()).divide(1e6)
        stats = area_image.reduceRegion(
            reducer=ee.Reducer.sum(),
            geometry=geometry,
            scale=30, # Sentinel-1 resolution
            maxPixels=1e9
        ).getInfo()
        
        flood_extent_km2 = stats.get('VV', 0)
        if flood_extent_km2 is None:
            flood_extent_km2 = 0
            
        # Get metadata
        system_time_start = crisis_image.get('system:time_start').getInfo()
        acq_date = datetime.utcfromtimestamp(system_time_start / 1000.0).isoformat() + "Z"
        
        orbit_pass = crisis_image.get('orbitProperties_pass').getInfo()
        
        latency = round(time.time() - start_time, 2)
        
        return {
            "status": "success",
            "acquisition_timestamp": acq_date,
            "satellite": "Sentinel-1A/B IW GRD",
            "polarization": "VV",
            "orbit_pass": str(orbit_pass).upper(),
            "threshold_used_db": threshold_db,
            "sar_flood_extent_km2": round(flood_extent_km2, 2),
            "query_latency_sec": latency,
            "tile_url": tile_url,
            "permanent_water_masked": True,
            "slope_masked": True
        }
