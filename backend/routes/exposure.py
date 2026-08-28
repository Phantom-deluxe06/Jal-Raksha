from fastapi import APIRouter, HTTPException
from services.exposure_service import VulnerabilityEngine

exposure_router = APIRouter(prefix="/api/exposure", tags=["exposure"])

@exposure_router.get("/{scenario_id}/summary")
def get_exposure_summary(scenario_id: str):
    try:
        engine = VulnerabilityEngine(scenario_id)
        summary = engine.compute_exposure()
        if "error" in summary:
            raise HTTPException(status_code=500, detail=summary["error"])
        return summary
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
