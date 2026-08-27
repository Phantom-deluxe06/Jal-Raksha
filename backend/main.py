"""
FastAPI backend for FloodSim-HADR with Parameterizable Scenario System:

  POST /scenarios/run         -- launch a parameterized simulation scenario
  POST /scenarios/validate    -- validate scenario parameters & compute estimates
  GET  /scenarios/presets     -- predefined scenario templates (Kosi 2008, Controlled Release, Custom)
  GET  /scenarios/list        -- list all completed/available scenario runs
  POST /simulate/swe          -- (re)run SWE solver (supports custom scenario payload or default Kosi)
  GET  /simulate/status/{id}  -- honest job status: idle, queued, running, processing, complete, failed
  GET  /simulate/result/{id}  -- run metadata + frames + sanity checks + population impact
  GET  /simulate/frame/{id}/{filename} -- depth/velocity GeoTIFF or PNG overlay or GeoJSON
  GET  /export/{id}?format=geojson|shp|kml -- flood-extent GIS export

  POST /predict/instant       -- U-Net surrogate prediction
  GET  /sph/result            -- SPH particle-solver metadata + SWE comparison
  GET  /sph/snapshot/{t}      -- SPH particle positions/velocities at time-snapshot
  GET  /twin/state            -- last-synced real Kosi Barrage CWC gauge reading
  POST /twin/sync             -- trigger an immediate live re-sync
  GET  /realtime/water-extent -- live Sentinel-1 SAR water extent via GEE
  GET  /terrain/dem           -- SRTM DEM elevation grid (3D terrain view)
  GET  /terrain/satellite     -- Sentinel-2 true-colour preview (3D terrain view)
"""
import asyncio
import base64
import io
import json
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = Path(__file__).resolve().parent
OUTPUTS_DIR = BACKEND_DIR / "outputs"

sys.path.insert(0, str(BACKEND_DIR))
from swe.colorize import colorize_depth  # noqa: E402
from swe.scenario_runner import (
    execute_scenario,
    get_default_kosi_scenario,
    TARGET_RES_DEG,
)

app = FastAPI(title="FloodSim-HADR API — Parameterizable Scenario System")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory tracking of active jobs: job_id -> { status, step_message, error, started_at, completed_at }
_jobs_lock = threading.Lock()
_jobs_state: Dict[str, Dict[str, Any]] = {}


def _get_job_out_dir(job_id: str) -> Path:
    if job_id in ("kosi_actual2008", "kosi_2008_historical"):
        return OUTPUTS_DIR / "swe_kosi_actual2008"
    if (OUTPUTS_DIR / f"swe_{job_id}").exists():
        return OUTPUTS_DIR / f"swe_{job_id}"
    if (OUTPUTS_DIR / job_id).exists():
        return OUTPUTS_DIR / job_id
    return OUTPUTS_DIR / f"swe_{job_id}"


def _get_job_state(job_id: str) -> Dict[str, Any]:
    with _jobs_lock:
        if job_id in _jobs_state:
            return _jobs_state[job_id]

    out_dir = _get_job_out_dir(job_id)
    if (out_dir / "metadata.json").exists():
        return {"status": "complete", "step_message": "Completed", "error": None}
    return {"status": "idle", "step_message": "Not started", "error": None}


def _set_job_state(job_id: str, status: str, step_message: str = "", error: Optional[str] = None):
    with _jobs_lock:
        if job_id not in _jobs_state:
            _jobs_state[job_id] = {}
        _jobs_state[job_id]["status"] = status
        _jobs_state[job_id]["step_message"] = step_message
        _jobs_state[job_id]["error"] = error
        if status == "running" and "started_at" not in _jobs_state[job_id]:
            _jobs_state[job_id]["started_at"] = time.time()
        elif status in ("complete", "failed"):
            _jobs_state[job_id]["completed_at"] = time.time()


# --- Pydantic Data Models for Scenario System ---

class ScenarioMetadata(BaseModel):
    scenario_id: str = "custom_scenario"
    name: str = "Custom Scenario"
    scenario_type: str = "custom_dam_break"  # "historical" | "custom_dam_break" | "controlled_release"
    description: str = ""
    author: Optional[str] = "Operator"
    created_at: Optional[str] = None


class StudyAreaBounds(BaseModel):
    west: float = 86.6
    south: float = 25.9
    east: float = 87.3
    north: float = 26.7


class StudyAreaConfig(BaseModel):
    name: str = "Kosi River Basin (North Bihar AOI)"
    river_name: str = "Kosi (Koshi) River"
    basin: str = "Kosi Basin, Ganga Sub-basin"
    dem_file: str = "data/dem/kosi_aoi_srtm30m.tif"
    bounds: StudyAreaBounds = Field(default_factory=StudyAreaBounds)


class DamConfig(BaseModel):
    name: str = "Kusaha Afflux Embankment / Kosi Barrage"
    structure_type: str = "embankment_breach"
    barrage_name: str = "Kosi Barrage"
    barrage_coordinates: Dict[str, float] = Field(default_factory=lambda: {"lat": 26.5263, "lon": 86.9269})


class BreachCoordinates(BaseModel):
    lat: float = 26.62
    lon: float = 87.05


class BreachConfig(BaseModel):
    site_name: str = "Kusaha Breach Site"
    coordinates: BreachCoordinates = Field(default_factory=BreachCoordinates)
    width_m: float = 100.0
    ramp_minutes: float = 30.0


class InitialConditionsConfig(BaseModel):
    bed_condition: str = "dry_bed"
    initial_depth_m: float = 0.0


class WaterConditionsConfig(BaseModel):
    peak_discharge_cumecs: float = 3675.0
    discharge_source: str = "User defined scenario inflow"
    design_discharge_cumecs_NOT_USED: Optional[float] = 27000.0


class SimulationSettingsConfig(BaseModel):
    duration_hours: float = 4.0
    snapshot_interval_minutes: float = 15.0
    target_resolution_deg: float = TARGET_RES_DEG
    manning_n: float = 0.035
    cfl: float = 0.4
    flood_depth_threshold_m: float = 0.1


class ScenarioConfig(BaseModel):
    metadata: ScenarioMetadata = Field(default_factory=ScenarioMetadata)
    studyArea: StudyAreaConfig = Field(default_factory=StudyAreaConfig)
    dam: Optional[DamConfig] = Field(default_factory=DamConfig)
    breach: BreachConfig = Field(default_factory=BreachConfig)
    initialConditions: InitialConditionsConfig = Field(default_factory=InitialConditionsConfig)
    waterConditions: WaterConditionsConfig = Field(default_factory=WaterConditionsConfig)
    simulation: SimulationSettingsConfig = Field(default_factory=SimulationSettingsConfig)


@app.on_event("startup")
def _warm_surrogate():
    try:
        from ml.infer import predict
        from ml import config as ml_cfg
        predict(ml_cfg.BASE_DISCHARGE_CUMECS, *ml_cfg.BASE_BREACH_LATLON)
        print("[startup] ML surrogate warmed and ready")
    except FileNotFoundError:
        print("[startup] ML surrogate not trained yet -- /predict/instant will fail until backend/ml/train.py is run")
    except Exception as e:
        print(f"[startup] ML surrogate warm note: {e}")


DIGITAL_TWIN_POLL_INTERVAL_S = 3600


async def _digital_twin_poll_loop():
    from digital_twin.sync import sync_now
    loop = asyncio.get_event_loop()
    while True:
        try:
            await loop.run_in_executor(None, sync_now)
        except Exception as e:
            print(f"[digital_twin] background sync raised unexpectedly: {e}")
        await asyncio.sleep(DIGITAL_TWIN_POLL_INTERVAL_S)


@app.on_event("startup")
async def _start_digital_twin_sync():
    asyncio.create_task(_digital_twin_poll_loop())


# --- Scenario Management Endpoints ---

@app.get("/scenarios/presets")
def get_scenario_presets():
    """Return pre-configured scenario templates."""
    kosi_historical = get_default_kosi_scenario()

    controlled_release = {
        "metadata": {
            "scenario_id": "kosi_barrage_controlled_release",
            "name": "Controlled Water Release — Kosi Barrage",
            "scenario_type": "controlled_release",
            "description": "Controlled high-discharge spillway release from Kosi Barrage (Bhimnagar gates) during monsoon peak reservoir conditions.",
            "author": "FloodSim Operations Suite",
            "created_at": "2026-08-27",
        },
        "studyArea": kosi_historical["studyArea"],
        "dam": {
            "name": "Kosi Barrage (Bhimnagar Barrage)",
            "structure_type": "gated_barrage_release",
            "barrage_name": "Kosi Barrage",
            "barrage_coordinates": {"lat": 26.5263, "lon": 86.9269},
        },
        "breach": {
            "site_name": "Kosi Barrage Main Sluice Gates",
            "coordinates": {"lat": 26.5263, "lon": 86.9269},
            "width_m": 1149.0,
            "ramp_minutes": 10.0,
        },
        "initialConditions": {
            "bed_condition": "dry_bed",
            "initial_depth_m": 0.0,
        },
        "waterConditions": {
            "peak_discharge_cumecs": 12000.0,
            "discharge_source": "Controlled spillway operation (12,000 m³/s release)",
            "design_discharge_cumecs_NOT_USED": 27000.0,
        },
        "simulation": {
            "duration_hours": 3.0,
            "snapshot_interval_minutes": 15.0,
            "target_resolution_deg": TARGET_RES_DEG,
            "manning_n": 0.035,
            "cfl": 0.4,
            "flood_depth_threshold_m": 0.1,
        },
    }

    custom_template = {
        "metadata": {
            "scenario_id": "custom_breach_01",
            "name": "Custom Embankment Breach Scenario",
            "scenario_type": "custom_dam_break",
            "description": "Hypothetical embankment failure scenario on the Kosi River corridor.",
            "author": "Operator",
            "created_at": "2026-08-27",
        },
        "studyArea": kosi_historical["studyArea"],
        "dam": kosi_historical["dam"],
        "breach": {
            "site_name": "Hypothetical Breach Point",
            "coordinates": {"lat": 26.58, "lon": 86.98},
            "width_m": 120.0,
            "ramp_minutes": 25.0,
        },
        "initialConditions": {
            "bed_condition": "dry_bed",
            "initial_depth_m": 0.0,
        },
        "waterConditions": {
            "peak_discharge_cumecs": 5000.0,
            "discharge_source": "Hypothetical breach flow",
            "design_discharge_cumecs_NOT_USED": 27000.0,
        },
        "simulation": {
            "duration_hours": 4.0,
            "snapshot_interval_minutes": 15.0,
            "target_resolution_deg": TARGET_RES_DEG,
            "manning_n": 0.035,
            "cfl": 0.4,
            "flood_depth_threshold_m": 0.1,
        },
    }

    return {
        "presets": [
            kosi_historical,
            controlled_release,
            custom_template,
        ]
    }


@app.get("/scenarios/list")
def list_scenarios():
    """List all available completed simulation scenario runs."""
    runs = []
    if OUTPUTS_DIR.exists():
        for sub in OUTPUTS_DIR.iterdir():
            if sub.is_dir() and (sub / "metadata.json").exists():
                try:
                    meta = json.loads((sub / "metadata.json").read_text(encoding="utf-8"))
                    job_id = meta.get("scenario_id") or sub.name.replace("swe_", "")
                    runs.append({
                        "job_id": job_id,
                        "scenario_id": job_id,
                        "scenario_label": meta.get("scenario_label", job_id),
                        "scenario_type": meta.get("scenario_type", "simulation"),
                        "discharge_cumecs": meta.get("discharge_cumecs", 0),
                        "duration_hours": round(meta.get("solver", {}).get("duration_s", 0) / 3600, 1),
                        "max_flooded_area_km2": meta.get("max_flooded_area_km2", 0),
                        "max_depth_m": meta.get("max_depth_m", 0),
                        "breach_latlon": meta.get("breach_latlon", {}),
                        "wall_time_s": meta.get("solver", {}).get("wall_time_s", 0),
                    })
                except Exception as e:
                    print(f"Error reading metadata from {sub}: {e}")
    return {"scenarios": runs}


@app.post("/scenarios/validate")
def validate_scenario(scenario: ScenarioConfig):
    """Validate scenario parameters against physical constraints and AOI boundaries."""
    errors = []
    warnings = []

    # Check bounds
    bounds = scenario.studyArea.bounds
    lat = scenario.breach.coordinates.lat
    lon = scenario.breach.coordinates.lon

    if not (bounds.south <= lat <= bounds.north):
        errors.append(f"Breach latitude ({lat:.4f}°N) is outside the DEM study area [{bounds.south:.2f}°N to {bounds.north:.2f}°N].")
    if not (bounds.west <= lon <= bounds.east):
        errors.append(f"Breach longitude ({lon:.4f}°E) is outside the DEM study area [{bounds.west:.2f}°E to {bounds.east:.2f}°E].")

    # Numeric checks
    if scenario.waterConditions.peak_discharge_cumecs <= 0:
        errors.append("Peak discharge must be greater than 0 m³/s.")
    elif scenario.waterConditions.peak_discharge_cumecs > 35000:
        warnings.append("Discharge exceeds 35,000 m³/s (above catastrophic design flood). Check if intended.")

    if scenario.breach.width_m <= 0:
        errors.append("Breach width must be a positive number.")
    elif scenario.breach.width_m > 1000:
        warnings.append(f"Breach width ({scenario.breach.width_m}m) is unusually large.")

    if scenario.breach.ramp_minutes < 0:
        errors.append("Breach failure / ramp duration cannot be negative.")

    if scenario.simulation.duration_hours <= 0:
        errors.append("Simulation duration must be positive.")
    elif scenario.simulation.duration_hours > 8:
        warnings.append("Simulation duration > 8 hours will take longer to compute. Consider <= 6 hours for interactive exploration.")

    if scenario.simulation.snapshot_interval_minutes <= 0:
        errors.append("Snapshot interval must be positive.")
    elif scenario.simulation.snapshot_interval_minutes > scenario.simulation.duration_hours * 60:
        errors.append("Snapshot interval cannot be greater than total simulation duration.")

    if scenario.simulation.manning_n <= 0 or scenario.simulation.manning_n > 0.15:
        errors.append("Manning's n must be within plausible physical range (0.015 - 0.100).")

    # Estimated timesteps
    estimated_steps = int((scenario.simulation.duration_hours * 3600) / 10.0)

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "estimated_timesteps": estimated_steps,
        "estimated_frames": int((scenario.simulation.duration_hours * 60) / scenario.simulation.snapshot_interval_minutes) + 1,
    }


def _run_scenario_thread(scenario_dict: Dict[str, Any], job_id: str):
    _set_job_state(job_id, "queued", "Simulation queued...")
    try:
        def status_cb(status: str, msg: str):
            _set_job_state(job_id, status, msg)

        execute_scenario(scenario_dict, status_callback=status_cb)
        _set_job_state(job_id, "complete", "Simulation completed successfully.")
    except Exception as e:
        import traceback
        traceback.print_exc()
        _set_job_state(job_id, "failed", f"Simulation failed: {str(e)}", error=str(e))


@app.post("/scenarios/run")
def run_scenario_endpoint(scenario: ScenarioConfig):
    """Launch a parameterized SWE scenario simulation."""
    scenario_dict = scenario.dict()
    job_id = scenario.metadata.scenario_id or f"custom_{int(time.time())}"
    scenario_dict["metadata"]["scenario_id"] = job_id

    current_state = _get_job_state(job_id)
    if current_state.get("status") in ("running", "processing"):
        return {"job_id": job_id, "status": current_state["status"], "message": "Job is already running."}

    thread = threading.Thread(target=_run_scenario_thread, args=(scenario_dict, job_id), daemon=True)
    thread.start()

    return {
        "job_id": job_id,
        "status": "queued",
        "scenario_name": scenario.metadata.name,
        "scenario_type": scenario.metadata.scenario_type,
    }


@app.post("/simulate/swe")
def simulate_swe(scenario: Optional[ScenarioConfig] = None):
    """(Re)run the SWE solver. If scenario is provided, runs it; otherwise runs the historical Kosi case."""
    if scenario is not None:
        scenario_dict = scenario.dict()
        job_id = scenario.metadata.scenario_id or "kosi_actual2008"
    else:
        scenario_dict = get_default_kosi_scenario()
        job_id = "kosi_actual2008"

    scenario_dict["metadata"]["scenario_id"] = job_id

    current_state = _get_job_state(job_id)
    if current_state.get("status") in ("running", "processing"):
        return {"job_id": job_id, "status": current_state["status"]}

    # Run synchronously or in blocking thread
    _run_scenario_thread(scenario_dict, job_id)
    final_state = _get_job_state(job_id)

    return {
        "job_id": job_id,
        "status": final_state["status"],
        "error": final_state.get("error"),
    }


@app.get("/simulate/status/{job_id}")
def simulate_status(job_id: str):
    """Get honest job execution status."""
    state = _get_job_state(job_id)
    return {
        "job_id": job_id,
        "status": state["status"],
        "step_message": state.get("step_message", ""),
        "error": state.get("error"),
    }


@app.get("/simulate/result/{job_id}")
def simulate_result(job_id: str):
    """Retrieve metadata and results for any scenario run."""
    out_dir = _get_job_out_dir(job_id)
    meta_path = out_dir / "metadata.json"
    if not meta_path.exists():
        raise HTTPException(404, f"No results for scenario '{job_id}' yet. Run the simulation first.")
    return JSONResponse(json.loads(meta_path.read_text(encoding="utf-8")))


@app.get("/simulate/impact/{job_id}")
def simulate_impact(job_id: str):
    """Retrieve full Flood Impact Analysis Engine report for any scenario run."""
    out_dir = _get_job_out_dir(job_id)
    impact_path = out_dir / "impact_analysis.json"
    if impact_path.exists():
        return JSONResponse(json.loads(impact_path.read_text(encoding="utf-8")))

    meta_path = out_dir / "metadata.json"
    if not meta_path.exists():
        raise HTTPException(404, f"No results for scenario '{job_id}' yet. Run the simulation first.")

    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if "impact_analysis" in meta:
        return JSONResponse(meta["impact_analysis"])

    # If impact_analysis is not yet in legacy metadata, compute it on the fly
    from swe.impact_engine import run_impact_analysis, POP_DEFAULT_PATH, SETTLEMENTS_DEFAULT_PATH
    import rasterio

    frames = meta.get("frames", [])
    if not frames:
        raise HTTPException(404, "No simulation frames found.")

    times_s = [f.get("t_seconds", f.get("t_minutes", 0) * 60.0) for f in frames]
    depth_frames = []
    grid_transform = None
    grid_crs = None
    for f in frames:
        depth_tif = out_dir / f["depth_tif"]
        with rasterio.open(depth_tif) as src:
            depth_frames.append(src.read(1))
            if grid_transform is None:
                grid_transform = src.transform
                grid_crs = src.crs

    max_depth = np.maximum.reduce(depth_frames)
    dx = meta.get("grid", {}).get("dx_m", 166.33)
    dy = meta.get("grid", {}).get("dy_m", 185.54)

    impact = run_impact_analysis(
        times_s=times_s,
        depth_frames=depth_frames,
        max_depth=max_depth,
        grid_transform=grid_transform,
        grid_crs=grid_crs,
        grid_dx=dx,
        grid_dy=dy,
        pop_path=POP_DEFAULT_PATH,
        settlements_path=SETTLEMENTS_DEFAULT_PATH,
    )
    # Cache to file
    impact_path.write_text(json.dumps(impact, indent=2, default=str), encoding="utf-8")
    return JSONResponse(impact)



@app.get("/simulate/frame/{job_id}/{filename}")
def simulate_frame(job_id: str, filename: str):
    """Serve depth/velocity GeoTIFF, PNG overlay, or GeoJSON frame for any scenario run."""
    out_dir = _get_job_out_dir(job_id)
    for subdir in ("frames", "overlays", "geojson"):
        candidate = out_dir / subdir / filename
        if candidate.exists():
            return FileResponse(candidate, headers={"Cache-Control": "no-store"})
    raise HTTPException(404, f"Frame file not found: {filename} in scenario {job_id}")


@app.get("/export/{job_id}")
def export(job_id: str, format: str = "geojson"):
    """Export vector flood footprint in GeoJSON, Shapefile, or KML."""
    out_dir = _get_job_out_dir(job_id)
    ext_map = {"geojson": "geojson", "shp": "shp", "kml": "kml"}
    if format not in ext_map:
        raise HTTPException(400, f"format must be one of {list(ext_map)}")
    path = out_dir / "export" / f"flood_extent_max.{ext_map[format]}"
    if not path.exists():
        raise HTTPException(404, f"Export file not found for scenario '{job_id}' -- run the simulation first.")
    return FileResponse(path, filename=path.name)


# --- ML Surrogate Prediction ---

class PredictRequest(BaseModel):
    discharge_cumecs: float | None = None
    lat: float | None = None
    lon: float | None = None


@app.post("/predict/instant")
def predict_instant(req: PredictRequest):
    from ml import config as ml_cfg
    from ml.infer import predict

    discharge = req.discharge_cumecs if req.discharge_cumecs is not None else ml_cfg.BASE_DISCHARGE_CUMECS
    lat, lon = (req.lat, req.lon) if req.lat is not None and req.lon is not None else ml_cfg.BASE_BREACH_LATLON

    try:
        result = predict(discharge, lat, lon)
    except FileNotFoundError:
        raise HTTPException(409, "Surrogate model not trained yet -- run backend/ml/train.py first")

    depth = result["depth"]
    rgba = colorize_depth(depth, dry_threshold=ml_cfg.FLOOD_DEPTH_THRESHOLD_M)
    from PIL import Image
    buf = io.BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(buf, format="PNG")
    overlay_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    is_actual_2008 = abs(discharge - ml_cfg.BASE_DISCHARGE_CUMECS) < 1.0

    return {
        "scenario_label": "INSTANT AI PREDICTION (U-Net surrogate)"
        + (" — actual 2008 discharge" if is_actual_2008 else " — custom hypothetical discharge"),
        "discharge_cumecs": discharge,
        "is_actual_2008_discharge": is_actual_2008,
        "breach_latlon": {"lat": lat, "lon": lon},
        "bounds": dict(zip(["west", "south", "east", "north"], result["bounds"])),
        "flooded_area_km2": result["flooded_area_km2"],
        "max_depth_m": result["max_depth_m"],
        "inference_s": result["inference_s"],
        "grid_resolution_m": [round(result["grid"].dx), round(result["grid"].dy)],
        "overlay_png_base64": overlay_b64,
        "caveat": (
            "Surrogate model trained on 60 real SWE solver runs. "
            "Runs on a coarser ~300m grid for training-data throughput."
        ),
    }


# --- Terrain & Satellite ---

@app.get("/terrain/dem")
def get_terrain_dem(downsample: int = 1):
    """Serve the real SRTM DEM elevation grid for 3D terrain mesh rendering."""
    from swe.dem_utils import load_dem_grid
    import numpy as np

    dem_path = str(DEM_DEFAULT_PATH)
    grid = load_dem_grid(dem_path, TARGET_RES_DEG)
    elev = grid.elevation

    if downsample > 1:
        elev = elev[::downsample, ::downsample]

    min_val = float(np.nanmin(elev))
    max_val = float(np.nanmax(elev))

    elev_clean = np.nan_to_num(elev, nan=min_val).astype(float)
    flat_elev = [round(float(v), 2) for v in elev_clean.flatten()]

    return {
        "rows": elev_clean.shape[0],
        "cols": elev_clean.shape[1],
        "min_elevation": min_val,
        "max_elevation": max_val,
        "dx_m": grid.dx * downsample,
        "dy_m": grid.dy * downsample,
        "elevations": flat_elev,
    }


@app.get("/terrain/satellite")
def get_terrain_satellite():
    """Serve the real Sentinel-2 satellite true-colour preview for the AOI."""
    sat_path = ROOT / "data" / "satellite" / "preview.png"
    if not sat_path.exists():
        raise HTTPException(404, "satellite preview image not found")
    return FileResponse(sat_path, media_type="image/png", headers={"Cache-Control": "no-store"})


# --- SPH Particle Physics ---

@app.get("/sph/result")
def get_sph_result():
    sph_meta_path = OUTPUTS_DIR / "sph_kosi_breach" / "metadata.json"
    if not sph_meta_path.exists():
        raise HTTPException(404, "SPH simulation results not generated yet")
    return JSONResponse(json.loads(sph_meta_path.read_text(encoding="utf-8")))


@app.get("/sph/snapshot/{t_seconds}")
def get_sph_snapshot(t_seconds: int):
    snap_path = OUTPUTS_DIR / "sph_kosi_breach" / "snapshots" / f"sph_t{t_seconds:04d}.json"
    if not snap_path.exists():
        raise HTTPException(404, f"SPH snapshot at t={t_seconds}s not found")
    return JSONResponse(json.loads(snap_path.read_text(encoding="utf-8")))


# --- Digital Twin & SAR ---

@app.get("/twin/state")
def twin_state():
    from digital_twin.sync import STATE_PATH
    if not STATE_PATH.exists():
        raise HTTPException(404, "no digital twin sync has run yet")
    return JSONResponse(json.loads(STATE_PATH.read_text(encoding="utf-8")))


@app.post("/twin/sync")
def twin_sync():
    from digital_twin.sync import sync_now
    result = sync_now()
    return JSONResponse(result)


class CompareSarRequest(BaseModel):
    job_id: str = "kosi_actual2008"
    frame_index: Optional[int] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    orbit_pass: Optional[str] = None
    threshold_db: float = -17.0


@app.get("/realtime/auth-status")
def realtime_auth_status():
    """Check Google Earth Engine authentication status and return setup instructions if missing."""
    from realtime.gee_water_extent import check_auth_status
    return JSONResponse(check_auth_status())


@app.get("/realtime/water-extent")
def realtime_water_extent(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    orbit_pass: Optional[str] = None,
    threshold_db: float = -17.0,
):
    """Query live Sentinel-1 SAR water extent from Google Earth Engine."""
    from realtime.gee_water_extent import fetch_latest_water_extent, GeeAuthError, GeeError
    try:
        result = fetch_latest_water_extent(
            start_date=start_date,
            end_date=end_date,
            orbit_pass=orbit_pass,
            threshold_db=threshold_db,
        )
    except GeeAuthError as e:
        raise HTTPException(401, detail=str(e))
    except GeeError as e:
        raise HTTPException(502, detail=str(e))
    return JSONResponse(result)


@app.post("/realtime/compare")
def realtime_compare(req: CompareSarRequest):
    """Compare SWE flood simulation extent against Sentinel-1 SAR observation."""
    from realtime.gee_water_extent import (
        fetch_latest_water_extent,
        compare_swe_vs_sar,
        GeeAuthError,
        GeeError,
    )
    try:
        sar_fc = fetch_latest_water_extent(
            start_date=req.start_date,
            end_date=req.end_date,
            orbit_pass=req.orbit_pass,
            threshold_db=req.threshold_db,
        )
        comparison = compare_swe_vs_sar(
            sar_fc=sar_fc,
            job_id=req.job_id,
            frame_index=req.frame_index,
        )
    except GeeAuthError as e:
        raise HTTPException(401, detail=str(e))
    except GeeError as e:
        raise HTTPException(502, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(404, detail=str(e))
    return JSONResponse(comparison)


@app.get("/health")
def health():
    return {"status": "ok"}

