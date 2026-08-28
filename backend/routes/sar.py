from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
from services.gee_sar_service import GeneralizedGEEService

sar_router = APIRouter(prefix="/api/sar", tags=["sar"])

class SARRequest(BaseModel):
    bbox: List[float] # [min_lon, min_lat, max_lon, max_lat]
    target_date: str # "YYYY-MM-DD"
    threshold_db: float = -17.0

@sar_router.post("/analyze")
def analyze_sar(request: SARRequest):
    try:
        service = GeneralizedGEEService()
        result = service.extract_flood_extent(
            bbox=tuple(request.bbox),
            target_date=request.target_date,
            threshold_db=request.threshold_db
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
