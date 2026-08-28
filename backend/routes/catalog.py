from fastapi import APIRouter, HTTPException, Query
from typing import Optional
from services.catalog_service import catalog_service

catalog_router = APIRouter(prefix="/api/catalog", tags=["catalog"])

@catalog_router.get("/dams")
def search_dams(
    query: Optional[str] = Query("", description="Search by dam name or river"),
    state: Optional[str] = Query("", description="Filter by state"),
    limit: int = Query(50, description="Max results")
):
    """Autocomplete and search dams."""
    results = catalog_service.search_dams(query=query, state=state, limit=limit)
    return {"dams": results}

@catalog_router.get("/dams/{dam_id}")
def get_dam(dam_id: str):
    """Retrieve detailed structural and spatial specs for a dam."""
    dam = catalog_service.get_dam(dam_id)
    if not dam:
        raise HTTPException(status_code=404, detail=f"Dam {dam_id} not found")
    return dam

@catalog_router.get("/dams/{dam_id}/downstream-aoi")
def get_dam_aoi(
    dam_id: str,
    buffer_km: float = Query(30.0, description="Buffer size in km for bounding box")
):
    """Compute and return the downstream AOI bounding box GeoJSON."""
    aoi = catalog_service.get_downstream_aoi(dam_id, buffer_km)
    if not aoi:
        raise HTTPException(status_code=404, detail=f"AOI for Dam {dam_id} could not be computed")
    return aoi

@catalog_router.get("/rivers")
def search_rivers(name: str = Query(..., description="River name to search")):
    """Fetch river reach geometry."""
    results = catalog_service.search_rivers(name=name)
    return {"rivers": results}
