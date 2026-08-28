from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pathlib import Path
from services.export_service import GISExportEngine
from services.ue5_export_service import UE5ExportService

export_router = APIRouter(prefix="/api/export", tags=["export"])
EXPORT_DIR = Path("backend/data/exports")
EXPORT_DIR.mkdir(parents=True, exist_ok=True)

@export_router.get("/{scenario_id}/shapefile")
def export_shapefile(scenario_id: str):
    try:
        engine = GISExportEngine(scenario_id)
        out_path = EXPORT_DIR / f"flood_extent_{scenario_id}.zip"
        engine.export_shapefile(str(out_path))
        return FileResponse(path=out_path, filename=out_path.name, media_type="application/zip")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@export_router.get("/{scenario_id}/kml")
def export_kml(scenario_id: str):
    try:
        engine = GISExportEngine(scenario_id)
        out_path = EXPORT_DIR / f"flood_inundation_{scenario_id}.kml"
        engine.export_kml(str(out_path))
        return FileResponse(path=out_path, filename=out_path.name, media_type="application/vnd.google-earth.kml+xml")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@export_router.get("/{scenario_id}/ue5-package")
def export_ue5_package(scenario_id: str):
    """Package simulation outputs for Unreal Engine 5 Niagara / Water plugin."""
    try:
        service = UE5ExportService(scenario_id)
        out_path = EXPORT_DIR / f"ue5_bundle_{scenario_id}.zip"
        service.build_package(str(out_path))
        return FileResponse(
            path=out_path, filename=out_path.name, media_type="application/zip"
        )
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@export_router.get("/{scenario_id}/geojson")
def export_geojson(scenario_id: str):
    try:
        engine = GISExportEngine(scenario_id)
        out_path = EXPORT_DIR / f"flood_extent_{scenario_id}.geojson"
        engine.export_geojson(str(out_path))
        return FileResponse(path=out_path, filename=out_path.name, media_type="application/geo+json")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
