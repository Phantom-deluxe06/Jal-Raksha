"""
FastAPI backend for FloodSim-HADR, covering all 5 PRD build priorities:

  POST /simulate/swe          -- (re)run the solver, near-sync (blocks until done)
  GET  /simulate/status/{id}  -- job status (this stage only has one job: "kosi_actual2008")
  GET  /simulate/result/{id}  -- run metadata + per-frame links
  GET  /simulate/frame/{id}/{t_minutes} -- a single depth GeoTIFF
  GET  /export/{id}?format=geojson|shp|kml -- flood-extent export

  POST /predict/instant       -- U-Net surrogate prediction, warmed at startup so
                                  every request (not just steady-state ones) is fast
  GET  /sph/result            -- SPH particle-solver metadata + SWE comparison metrics
  GET  /sph/snapshot/{t}      -- SPH particle positions/velocities at one time-snapshot
  GET  /twin/state            -- last-synced real Kosi Barrage CWC gauge reading
  POST /twin/sync             -- trigger an immediate live re-sync
  GET  /realtime/water-extent -- live Sentinel-1 SAR water extent via Google Earth Engine
  GET  /terrain/dem           -- SRTM DEM elevation grid (3D terrain view)
  GET  /terrain/satellite     -- Sentinel-2 true-colour preview (3D terrain view)
"""
import asyncio
import base64
import io
import json
import subprocess
import sys
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = Path(__file__).resolve().parent
OUTPUTS_DIR = BACKEND_DIR / "outputs"
RUN_SCRIPT = BACKEND_DIR / "swe" / "run_kosi_swe.py"

sys.path.insert(0, str(BACKEND_DIR))
from swe.colorize import colorize_depth  # noqa: E402

JOB_ID = "kosi_actual2008"
JOB_OUT_DIR = OUTPUTS_DIR / "swe_kosi_actual2008"

app = FastAPI(title="FloodSim-HADR API (SWE vertical slice)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_job_state = {"status": "idle", "error": None}
_job_lock = threading.Lock()


@app.on_event("startup")
def _warm_surrogate():
    """Load the ML model + DEM onto the GPU at server startup rather than on
    the first user request -- otherwise that first /predict/instant call
    pays a ~3.5s cold-start cost (model + DEM load) instead of the ~0.1s a
    warm forward pass takes, which would blow the <2-3s budget."""
    try:
        from ml.infer import predict
        from ml import config as ml_cfg
        predict(ml_cfg.BASE_DISCHARGE_CUMECS, *ml_cfg.BASE_BREACH_LATLON)
        print("[startup] ML surrogate warmed and ready")
    except (FileNotFoundError, ModuleNotFoundError, ImportError) as e:
        print(f"[startup] ML surrogate not available ({e}) -- /predict/instant will fail until dependencies are installed")


# The real CWC source (see digital_twin/cwc_client.py) itself only updates
# ~once daily (empirically measured in digital_twin/sync.py) -- polling more
# often than this just hammers their server for no new information. This
# interval only re-checks for a new day's reading; it does not, and cannot,
# make the underlying data more frequent than it actually is.
DIGITAL_TWIN_POLL_INTERVAL_S = 3600


async def _digital_twin_poll_loop():
    from digital_twin.sync import sync_now
    loop = asyncio.get_event_loop()
    while True:
        try:
            await loop.run_in_executor(None, sync_now)
        except Exception as e:  # never let a bad sync kill the poll loop
            print(f"[digital_twin] background sync raised unexpectedly: {e}")
        await asyncio.sleep(DIGITAL_TWIN_POLL_INTERVAL_S)


@app.on_event("startup")
async def _start_digital_twin_sync():
    asyncio.create_task(_digital_twin_poll_loop())
    print(f"[startup] Digital Twin background sync started (checks every "
          f"{DIGITAL_TWIN_POLL_INTERVAL_S/3600:.0f}h; source itself updates ~daily -- "
          f"this only catches a new day's reading sooner than waiting for a manual sync, "
          f"it does not make the source itself update faster)")


def _run_job():
    with _job_lock:
        _job_state["status"] = "running"
        _job_state["error"] = None
    try:
        subprocess.run(
            [sys.executable, str(RUN_SCRIPT)],
            check=True, cwd=str(ROOT),
        )
        with _job_lock:
            _job_state["status"] = "complete"
        try:
            from swe.swe_query import SimulationQueryEngine
            SimulationQueryEngine.invalidate_cache(JOB_ID)
        except Exception:
            pass
    except subprocess.CalledProcessError as e:
        with _job_lock:
            _job_state["status"] = "failed"
            _job_state["error"] = str(e)


@app.post("/simulate/swe")
def simulate_swe():
    if _job_state["status"] == "running":
        return {"job_id": JOB_ID, "status": "running"}
    t = threading.Thread(target=_run_job, daemon=True)
    t.start()
    t.join()  # near-sync per PRD (SWE run is fast enough to block on)
    return {"job_id": JOB_ID, "status": _job_state["status"], "error": _job_state["error"]}


@app.get("/simulate/status/{job_id}")
def simulate_status(job_id: str):
    if job_id != JOB_ID:
        raise HTTPException(404, "unknown job_id")
    has_output = (JOB_OUT_DIR / "metadata.json").exists()
    status = _job_state["status"] if _job_state["status"] != "idle" or not has_output else "complete"
    return {"job_id": job_id, "status": status, "error": _job_state["error"]}


@app.get("/simulate/result/{job_id}")
def simulate_result(job_id: str):
    if job_id != JOB_ID:
        raise HTTPException(404, "unknown job_id")
    meta_path = JOB_OUT_DIR / "metadata.json"
    if not meta_path.exists():
        raise HTTPException(404, "no results yet -- POST /simulate/swe first")
    return JSONResponse(json.loads(meta_path.read_text()))


@app.get("/simulate/frame/{job_id}/{filename}")
def simulate_frame(job_id: str, filename: str):
    if job_id != JOB_ID:
        raise HTTPException(404, "unknown job_id")
    for subdir in ("frames", "overlays", "geojson"):
        candidate = JOB_OUT_DIR / subdir / filename
        if candidate.exists():
            # no-store: the 3D view's WebGL texture loader (crossOrigin='anonymous')
            # and the 2D map's plain <img> overlay both request this same URL in
            # different fetch modes; letting the browser cache a response fetched
            # in one mode causes the other mode's request to fail outright
            # (observed as a CORS error even though the server's live response
            # always includes the right header -- confirmed via direct curl).
            return FileResponse(candidate, headers={"Cache-Control": "no-store"})
    raise HTTPException(404, f"frame file not found: {filename}")


@app.get("/simulate/query-point/{job_id}")
def query_point(job_id: str, lat: float, lon: float, threshold: float = 0.1):
    if job_id != JOB_ID:
        raise HTTPException(404, "unknown job_id")
    try:
        from swe.swe_query import SimulationQueryEngine
        engine = SimulationQueryEngine.get_engine(job_id)
        return JSONResponse(engine.query_point(lat, lon, threshold_m=threshold))
    except FileNotFoundError:
        raise HTTPException(404, "simulation results not found -- run the simulation first")
    except Exception as e:
        raise HTTPException(500, f"point query error: {str(e)}")


@app.get("/export/{job_id}")
def export(job_id: str, format: str = "geojson"):
    if job_id != JOB_ID:
        raise HTTPException(404, "unknown job_id")
    ext_map = {"geojson": "geojson", "shp": "shp", "kml": "kml"}
    if format not in ext_map:
        raise HTTPException(400, f"format must be one of {list(ext_map)}")
    path = JOB_OUT_DIR / "export" / f"flood_extent_max.{ext_map[format]}"
    if not path.exists():
        raise HTTPException(404, "export file not found -- run the simulation first")
    return FileResponse(path, filename=path.name)


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
        raise HTTPException(409, "surrogate model not trained yet -- run backend/ml/train.py first")

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
            "Surrogate model trained on 60 real SWE solver runs (see backend/ml_checkpoints/training_report.json "
            "for honest validation metrics, including IoU/RMSE on held-out runs). Accuracy degrades outside the "
            "training parameter ranges. Also runs on a coarser ~300m grid than the Full SWE Simulation mode's "
            "~185m grid (for training-data throughput -- see backend/ml/config.py), so absolute numbers between "
            "the two modes won't match exactly even for the same discharge/location."
        ),
    }


@app.get("/terrain/dem")
def get_terrain_dem(downsample: int = 1):
    """Serve the real SRTM DEM elevation grid for 3D terrain mesh rendering."""
    from swe.dem_utils import load_dem_grid
    from swe import run_kosi_swe
    import numpy as np

    dem_path = str(run_kosi_swe.DEM_PATH)
    grid = load_dem_grid(dem_path, run_kosi_swe.TARGET_RES_DEG)
    elev = grid.elevation

    if downsample > 1:
        elev = elev[::downsample, ::downsample]

    min_val = float(np.nanmin(elev))
    max_val = float(np.nanmax(elev))

    # Clean any nans
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


@app.get("/sph/result")
def get_sph_result():
    """Serve SPH simulation metadata, physics formulation, and SWE comparison metrics."""
    sph_meta_path = OUTPUTS_DIR / "sph_kosi_breach" / "metadata.json"
    if not sph_meta_path.exists():
        raise HTTPException(404, "SPH simulation results not generated yet -- run backend/sph/run_kosi_sph.py first")
    return JSONResponse(json.loads(sph_meta_path.read_text()))


@app.get("/sph/snapshot/{t_seconds}")
def get_sph_snapshot(t_seconds: int):
    """Serve a single time-snapshot of SPH particle positions and velocities."""
    snap_path = OUTPUTS_DIR / "sph_kosi_breach" / "snapshots" / f"sph_t{t_seconds:04d}.json"
    if not snap_path.exists():
        raise HTTPException(404, f"SPH snapshot at t={t_seconds}s not found")
    return JSONResponse(json.loads(snap_path.read_text()))


@app.get("/twin/state")
def twin_state():
    from digital_twin.sync import STATE_PATH
    if not STATE_PATH.exists():
        raise HTTPException(404, "no digital twin sync has run yet -- POST /twin/sync or wait for the background poll")
    return JSONResponse(json.loads(STATE_PATH.read_text()))


@app.post("/twin/sync")
def twin_sync():
    from digital_twin.sync import sync_now
    result = sync_now()
    latest_attempt = result["sync_log"][0]
    if not latest_attempt["success"] and result.get("last_good_sync") is None:
        raise HTTPException(502, f"sync failed and no previous successful sync exists: {latest_attempt['error']}")
    return JSONResponse(result)


class CompareRequest(BaseModel):
    timestep_minutes: int | None = None
    sar_extent: dict | None = None


@app.get("/realtime/water-extent")
def realtime_water_extent():
    """Live Sentinel-1 SAR water-extent query via Google Earth Engine.
    Queries GEE fresh on every call and returns detected water polygons and metadata."""
    from realtime.gee_water_extent import fetch_latest_water_extent, GeeAuthError, GeeError
    try:
        result = fetch_latest_water_extent()
        return JSONResponse(result)
    except GeeAuthError as e:
        return JSONResponse(
            status_code=401,
            content={
                "error_type": "AUTH_REQUIRED",
                "message": str(e),
                "instructions": e.instructions,
            },
        )
    except GeeError as e:
        raise HTTPException(502, str(e))


@app.post("/realtime/compare")
def compare_realtime_sar(req: CompareRequest):
    """Compare SWE flood simulation extent against Sentinel-1 SAR observed water extent.
    Computes intersection, difference polygons, IoU, Precision, and Recall."""
    from realtime.sar_validation import compare_model_and_observation
    from realtime.gee_water_extent import fetch_latest_water_extent, GeeError

    # 1. Determine simulation extent GeoJSON
    meta_path = JOB_OUT_DIR / "metadata.json"
    if not meta_path.exists():
        raise HTTPException(404, "Simulation results not found -- run the simulation first")
    meta = json.loads(meta_path.read_text())

    sim_geojson = None
    timestep_label = "Maximum Modeled Extent"

    if req.timestep_minutes is not None:
        target_frame = next((f for f in meta.get("frames", []) if f["t_minutes"] == req.timestep_minutes), None)
        if target_frame:
            geojson_path = JOB_OUT_DIR / target_frame["geojson"]
            if geojson_path.exists():
                sim_geojson = json.loads(geojson_path.read_text())
                timestep_label = f"T+{req.timestep_minutes} min Extent"

    if sim_geojson is None:
        max_export = JOB_OUT_DIR / "export" / "flood_extent_max.geojson"
        if max_export.exists():
            sim_geojson = json.loads(max_export.read_text())
        else:
            raise HTTPException(404, "Flood extent GeoJSON not found")

    # 2. Determine SAR observed water extent
    sar_geojson = req.sar_extent
    sar_meta = None
    if not sar_geojson:
        try:
            sar_data = fetch_latest_water_extent()
            sar_geojson = sar_data
            sar_meta = sar_data.get("source")
        except Exception as e:
            raise HTTPException(502, f"Could not fetch SAR observation for comparison: {e}")
    else:
        sar_meta = sar_geojson.get("source")

    # 3. Perform spatial comparison
    result = compare_model_and_observation(
        sim_geojson=sim_geojson,
        obs_geojson=sar_geojson,
        scenario_label=meta.get("scenario_label", "ACTUAL 2008 KUSAHA BREACH"),
        timestep_label=timestep_label,
        sar_metadata=sar_meta,
    )
    return JSONResponse(result)


@app.get("/health")
def health():
    return {"status": "ok"}



