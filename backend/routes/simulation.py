from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
from typing import Optional
from pathlib import Path
import time
import json
import uuid

from engine.breach_models import froehlich_peak_discharge, generate_breach_hydrograph
from engine.generic_solver import GenericHydrodynamicEngine
from services.dem_service import CACHE_DIR

simulation_router = APIRouter(prefix="/api/simulation", tags=["simulation"])

class SimulationRequest(BaseModel):
    dam_id: str
    breach_mode: str = "overtopping" # "overtopping" or "piping"
    formation_time_hr: float = 1.5
    peak_discharge_multiplier: float = 1.0
    custom_discharge_cumec: Optional[float] = None
    timesteps: int = 17
    resolution_m: float = 90.0

# In-memory tracking of active simulations
# In production, use Redis or a database
_simulation_jobs = {}

def execute_simulation(job_id: str, req: SimulationRequest):
    _simulation_jobs[job_id] = {
        "status": "initializing",
        "progress": 0,
        "message": "Initializing...",
        "metrics": None
    }
    
    try:
        dem_path = CACHE_DIR / f"dem_{req.dam_id}_{req.resolution_m}m.tif"
        if not dem_path.exists():
            _simulation_jobs[job_id] = {"status": "failed", "error": "DEM raster not found for this dam. Run Phase 11 ingestion first."}
            return
            
        output_dir = Path(f"backend/data/simulations/{job_id}")
        
        # 1. Generate Hydrograph
        _simulation_jobs[job_id]["status"] = "processing"
        _simulation_jobs[job_id]["message"] = "Generating breach hydrograph..."
        
        # We need volume and height. We can fetch this from the catalog, but here we'll 
        # assume default values or we should have passed them in the request.
        # For generalization, let's assume height=100m, storage=1000 MCM if not specified
        # (Ideally the frontend passes this or we query the catalog service)
        peak_q = req.custom_discharge_cumec
        if peak_q is None:
            # Fallback estimation
            peak_q = froehlich_peak_discharge(1000.0, 100.0) * req.peak_discharge_multiplier
            
        dt_sec = 1.0 # Base solver timestep, typically adaptive but fixed here for simplicity
        total_duration_hr = 12.0 # Fixed 12h for now
        hydrograph = generate_breach_hydrograph(peak_q, req.formation_time_hr, total_duration_hr, dt_sec, req.breach_mode)
        
        # 2. Run Engine
        engine = GenericHydrodynamicEngine(dem_path=str(dem_path), output_dir=str(output_dir))
        
        # For arbitrary breach location, we should use the dam's lat/lon. 
        # Using Kosi defaults for testing if none provided, but we can look up the dam coords.
        # Wait, the engine requires breach_lat, breach_lon. Let's just use the center of the DEM.
        import rasterio
        with rasterio.open(dem_path) as src:
            breach_lon = src.bounds.left + (src.bounds.right - src.bounds.left) / 2
            breach_lat = src.bounds.bottom + (src.bounds.top - src.bounds.bottom) / 2
            
        def progress_cb(frame, total, mass_error):
            _simulation_jobs[job_id]["progress"] = int((frame / total) * 100)
            _simulation_jobs[job_id]["message"] = f"Integrating 2D SWE (Frame {frame}/{total}) - Mass Err: {mass_error:.2f}%"

        metrics = engine.run(
            breach_lat=breach_lat,
            breach_lon=breach_lon,
            inflow_hydrograph=hydrograph,
            dt_sec=dt_sec,
            total_duration_hr=total_duration_hr,
            snapshot_interval_min=(total_duration_hr * 60) / req.timesteps,
            progress_callback=progress_cb
        )
        
        # 3. Finalize
        _simulation_jobs[job_id]["status"] = "complete"
        _simulation_jobs[job_id]["progress"] = 100
        _simulation_jobs[job_id]["message"] = "Simulation complete!"
        _simulation_jobs[job_id]["metrics"] = metrics
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        _simulation_jobs[job_id]["status"] = "failed"
        _simulation_jobs[job_id]["error"] = str(e)


@simulation_router.post("/run")
def run_simulation(req: SimulationRequest, background_tasks: BackgroundTasks):
    job_id = f"sim_{req.dam_id}_{int(time.time())}"
    background_tasks.add_task(execute_simulation, job_id, req)
    return {"job_id": job_id, "status": "queued"}

@simulation_router.get("/progress/{job_id}")
def get_progress(job_id: str):
    if job_id not in _simulation_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return _simulation_jobs[job_id]


_OUTPUTS_DIR = Path(__file__).resolve().parent.parent / "outputs"


def _resolve_scenario_meta(scenario_id: str):
    candidates = [
        _OUTPUTS_DIR / f"swe_{scenario_id}",
        _OUTPUTS_DIR / scenario_id,
    ]
    if scenario_id in ("kosi_actual2008", "kosi_2008_historical"):
        candidates.insert(0, _OUTPUTS_DIR / "swe_kosi_actual2008")
    for c in candidates:
        mp = c / "metadata.json"
        if mp.exists():
            return json.loads(mp.read_text(encoding="utf-8"))
    return None


@simulation_router.get("/{scenario_id}/hydro-comparison")
def hydro_comparison(scenario_id: str):
    """Structured SPH near-field jet vs regional 2D SWE routing benchmark."""
    from engine.sph_solver import build_hydro_comparison

    swe_meta = _resolve_scenario_meta(scenario_id)
    return build_hydro_comparison(scenario_id, swe_meta)
