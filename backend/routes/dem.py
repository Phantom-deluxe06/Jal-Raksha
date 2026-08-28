from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
from pathlib import Path

from services.dem_service import dem_engine, CACHE_DIR

dem_router = APIRouter(prefix="/api/dem", tags=["dem"])

class DEMRequest(BaseModel):
    dam_id: str
    bbox: List[float] # [min_lon, min_lat, max_lon, max_lat]
    resolution_m: Optional[float] = 90.0

@dem_router.post("/fetch-aoi")
def fetch_aoi(request: DEMRequest):
    """
    Programmatically fetches/clips real 30m Digital Elevation Model (DEM) data 
    (Copernicus GLO-30 via AWS Open Data) for the dynamic AOI bounding box.
    """
    if len(request.bbox) != 4:
        raise HTTPException(status_code=400, detail="bbox must be exactly 4 coordinates [min_lon, min_lat, max_lon, max_lat]")
        
    result = dem_engine.fetch_aoi(
        dam_id=request.dam_id,
        bbox=request.bbox,
        target_resolution_m=request.resolution_m
    )
    
    return result

@dem_router.get("/preview/{dam_id}.png")
def get_dem_preview(dam_id: str):
    """
    Serves the generated hillshade PNG preview of the clipped AOI.
    """
    # Look for any matching png in the cache
    matching_files = list(CACHE_DIR.glob(f"dem_{dam_id}_*.png"))
    
    if not matching_files:
        # Fallback to Kosi if requested
        fallback = CACHE_DIR / "dem_kosi_fallback_90.0m.png"
        if fallback.exists():
            return FileResponse(fallback, media_type="image/png")
        raise HTTPException(status_code=404, detail="Preview not found")
        
    # Return the most recently modified if there are multiple resolutions
    latest_file = max(matching_files, key=lambda p: p.stat().st_mtime)
    return FileResponse(latest_file, media_type="image/png")

@dem_router.get("/download/{dam_id}")
def download_dem_raster(dam_id: str):
    """
    Serves the raw clipped DEM GeoTIFF.
    """
    matching_files = list(CACHE_DIR.glob(f"dem_{dam_id}_*.tif"))
    
    if not matching_files:
        raise HTTPException(status_code=404, detail="Raster not found")
        
    latest_file = max(matching_files, key=lambda p: p.stat().st_mtime)
    return FileResponse(latest_file, media_type="image/tiff", filename=latest_file.name)
