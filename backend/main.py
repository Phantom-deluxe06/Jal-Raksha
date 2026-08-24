"""
Minimal FastAPI backend for the SWE vertical slice.

Implements the subset of the PRD's Section 3 endpoints needed for this stage:
  POST /simulate/swe          -- (re)run the solver, near-sync (blocks until done)
  GET  /simulate/status/{id}  -- job status (this stage only has one job: "kosi_actual2008")
  GET  /simulate/result/{id}  -- run metadata + per-frame links
  GET  /simulate/frame/{id}/{t_minutes} -- a single depth GeoTIFF
  GET  /export/{id}?format=geojson|shp|kml -- flood-extent export

  POST /predict/instant       -- U-Net surrogate prediction, warmed at startup so
                                  every request (not just steady-state ones) is fast

SPH, comparison, and GEE endpoints are intentionally not implemented yet --
out of scope for this stage.
"""
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
    except FileNotFoundError:
        print("[startup] ML surrogate not trained yet -- /predict/instant will fail until backend/ml/train.py is run")


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
            return FileResponse(candidate)
    raise HTTPException(404, f"frame file not found: {filename}")


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


@app.get("/health")
def health():
    return {"status": "ok"}
