"""
Shared configuration for the ML surrogate pipeline: grid resolution and
breach-parameter sampling ranges. Kept separate from the full-resolution
SWE stage (backend/swe/) -- the surrogate trains on a coarser grid for
tractable training-data generation time; this is a documented, deliberate
resolution tradeoff, not a hidden shortcut.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DEM_PATH = ROOT / "data" / "dem" / "kosi_aoi_srtm30m.tif"
CONFIG_PATH = ROOT / "data" / "dam_config" / "kosi_case_study.json"

ML_DATA_DIR = Path(__file__).resolve().parent.parent / "ml_data"
ML_CHECKPOINT_DIR = Path(__file__).resolve().parent.parent / "ml_checkpoints"

TARGET_RES_DEG = 0.0027  # ~300m grid spacing -- coarser than the 185m SWE-stage grid, for training-data throughput
DURATION_S = 4 * 3600.0  # matches the primary SWE scenario's simulated duration
FLOOD_DEPTH_THRESHOLD_M = 0.1

_config = json.loads(CONFIG_PATH.read_text())
_breach_cfg = _config["structure"]["breach_site"]["coordinates"]
_event = _config["breach_event"]
_sim_defaults = _config["simulation_defaults"]

BASE_BREACH_LATLON = (_breach_cfg["lat"], _breach_cfg["lon"])
BASE_DISCHARGE_CUMECS = _event["discharge_at_breach_cumecs"]  # 3675, actual 2008 value
BREACH_WIDTH_M = _sim_defaults["breach_width_m"]
RAMP_MINUTES = _sim_defaults["breach_hydrograph_ramp_minutes"]

# Sampling ranges for synthetic *scenario parameters* (not synthetic outputs --
# every depth grid used for training is a real solver run at these parameters).
# Discharge range follows dam_config.simulation_defaults.volume_override_range_pct
# (50%-150% of the documented actual discharge).
DISCHARGE_RANGE_CUMECS = (BASE_DISCHARGE_CUMECS * 0.5, BASE_DISCHARGE_CUMECS * 1.5)
# Breach location jitter: +/- this many grid cells around the documented
# (already-approximate) breach site, to sample nearby plausible embankment
# failure points without inventing new embankment geometry.
LOCATION_JITTER_CELLS = 6
