"""Fast inference wrapper for the FastAPI /predict/instant endpoint.
Loads the DEM + trained model once (module-level cache); each prediction
call is just a single forward pass, targeting well under the 2-3s budget."""
import json
import sys
import time
from pathlib import Path

import numpy as np
import rasterio
import torch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from swe.dem_utils import load_dem_grid, latlon_to_rowcol
from ml import config as cfg
from ml.features import build_input, unpad
from ml.model import FloodUNet

_state = {}


def _load():
    if _state:
        return _state
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    grid = load_dem_grid(str(cfg.DEM_PATH), cfg.TARGET_RES_DEG)
    model = FloodUNet(in_ch=3, base=24).to(device)
    ckpt_path = cfg.ML_CHECKPOINT_DIR / "flood_unet_best.pt"
    model.load_state_dict(torch.load(ckpt_path, map_location=device))
    model.eval()

    manifest = json.loads((cfg.ML_DATA_DIR / "manifest.json").read_text())
    discharge_range = tuple(manifest["discharge_range_cumecs"])

    _state.update(
        device=device, grid=grid, model=model, discharge_range=discharge_range,
        bounds=rasterio.transform.array_bounds(grid.rows, grid.cols, grid.transform),
    )
    return _state


def predict(discharge_cumecs: float, lat: float, lon: float) -> dict:
    t0 = time.time()
    state = _load()
    grid, model, device = state["grid"], state["model"], state["device"]

    row, col = latlon_to_rowcol(grid, lat, lon)
    x, orig_shape = build_input(grid.elevation, row, col, discharge_cumecs, state["discharge_range"])
    x_t = torch.from_numpy(x).unsqueeze(0).to(device)

    with torch.no_grad():
        pred = model(x_t).cpu().numpy()[0]
    depth = unpad(pred, orig_shape)
    depth = np.maximum(depth, 0.0)

    cell_area_km2 = (grid.dx * grid.dy) / 1e6
    flooded_km2 = float((depth >= cfg.FLOOD_DEPTH_THRESHOLD_M).sum() * cell_area_km2)
    elapsed = time.time() - t0

    return dict(
        depth=depth,
        grid=grid,
        breach_row=row,
        breach_col=col,
        flooded_area_km2=round(flooded_km2, 3),
        max_depth_m=round(float(depth.max()), 3),
        bounds=state["bounds"],
        inference_s=round(elapsed, 3),
    )
