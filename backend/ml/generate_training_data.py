"""
Generate ML-surrogate training data by actually running the real SWE solver
across varied breach scenarios (discharge, breach location) -- every sample
is a genuine solver output, not an estimate or interpolation.

Usage:
  .venv\\Scripts\\python.exe backend\\ml\\generate_training_data.py --n 50 --seed 0
"""
import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import rasterio

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from swe.dem_utils import load_dem_grid, latlon_to_rowcol
from swe.solver import BreachSource, SolverParams, run_swe
from ml import config as cfg


def sample_params(rng: np.random.Generator, base_row: int, base_col: int, rows: int, cols: int):
    discharge = rng.uniform(*cfg.DISCHARGE_RANGE_CUMECS)
    d_row = rng.integers(-cfg.LOCATION_JITTER_CELLS, cfg.LOCATION_JITTER_CELLS + 1)
    d_col = rng.integers(-cfg.LOCATION_JITTER_CELLS, cfg.LOCATION_JITTER_CELLS + 1)
    row = int(np.clip(base_row + d_row, 2, rows - 3))
    col = int(np.clip(base_col + d_col, 2, cols - 3))
    return float(discharge), row, col


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=50)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--val-frac", type=float, default=0.2)
    args = ap.parse_args()

    cfg.ML_DATA_DIR.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(args.seed)

    print(f"Loading DEM at ~{cfg.TARGET_RES_DEG*111320:.0f}m resolution for ML data generation...")
    grid = load_dem_grid(str(cfg.DEM_PATH), cfg.TARGET_RES_DEG)
    print(f"  grid: {grid.rows} x {grid.cols} cells, dx={grid.dx:.1f}m, dy={grid.dy:.1f}m")

    base_row, base_col = latlon_to_rowcol(grid, *cfg.BASE_BREACH_LATLON)
    print(f"  base breach cell: ({base_row}, {base_col})")

    # elevation is identical across all samples (single catchment) -- store once
    elev_path = cfg.ML_DATA_DIR / "elevation.npy"
    np.save(elev_path, grid.elevation.astype(np.float32))
    bounds = rasterio.transform.array_bounds(grid.rows, grid.cols, grid.transform)

    n_val = max(1, int(round(args.n * args.val_frac)))
    n_train = args.n - n_val
    split_labels = ["train"] * n_train + ["val"] * n_val
    rng.shuffle(split_labels)

    manifest = []
    t0 = time.time()
    for i in range(args.n):
        discharge, row, col = sample_params(rng, base_row, base_col, grid.rows, grid.cols)
        breach = BreachSource(
            row=row, col=col, width_m=cfg.BREACH_WIDTH_M,
            peak_discharge_cumecs=discharge, ramp_minutes=cfg.RAMP_MINUTES,
        )
        t_run0 = time.time()
        result = run_swe(
            elevation=grid.elevation, dx=grid.dx, dy=grid.dy, breach=breach,
            duration_s=cfg.DURATION_S, snapshot_interval_s=cfg.DURATION_S,  # only need t=0 and final
            params=SolverParams(),
        )
        run_s = time.time() - t_run0
        final_depth = result.depth_frames[-1]

        sample_id = f"sample_{i:04d}"
        np.save(cfg.ML_DATA_DIR / f"{sample_id}_depth.npy", final_depth)

        flooded_km2 = float((final_depth >= cfg.FLOOD_DEPTH_THRESHOLD_M).sum() * grid.dx * grid.dy / 1e6)
        manifest.append(dict(
            id=sample_id,
            split=split_labels[i],
            discharge_cumecs=discharge,
            breach_row=row,
            breach_col=col,
            unstable=result.unstable,
            n_steps=result.n_steps,
            run_wall_s=round(run_s, 1),
            max_depth_m=float(final_depth.max()),
            flooded_area_km2=round(flooded_km2, 3),
        ))
        print(f"[{i+1}/{args.n}] {sample_id} split={split_labels[i]} Q={discharge:.0f}m3/s "
              f"loc=({row},{col}) -> flooded={flooded_km2:.1f}km2 max_d={final_depth.max():.2f}m "
              f"({run_s:.1f}s, unstable={result.unstable})")

    total_s = time.time() - t0
    manifest_meta = dict(
        n_samples=args.n,
        n_train=n_train,
        n_val=n_val,
        seed=args.seed,
        grid=dict(rows=grid.rows, cols=grid.cols, dx_m=grid.dx, dy_m=grid.dy, target_res_deg=cfg.TARGET_RES_DEG),
        bounds=dict(zip(["west", "south", "east", "north"], bounds)),
        duration_s=cfg.DURATION_S,
        discharge_range_cumecs=list(cfg.DISCHARGE_RANGE_CUMECS),
        base_breach_cell=[base_row, base_col],
        location_jitter_cells=cfg.LOCATION_JITTER_CELLS,
        total_wall_s=round(total_s, 1),
        note=(
            "Every sample here is the real output of backend/swe/solver.run_swe() run to "
            "completion at the stated parameters -- none are interpolated, estimated, or "
            "fabricated. Parameters are randomly sampled within the documented ranges in "
            "backend/ml/config.py."
        ),
        samples=manifest,
    )
    (cfg.ML_DATA_DIR / "manifest.json").write_text(json.dumps(manifest_meta, indent=2))
    n_unstable = sum(1 for m in manifest if m["unstable"])
    print(f"\nDone: {args.n} samples ({n_train} train / {n_val} val) in {total_s/60:.1f} min")
    print(f"Unstable runs: {n_unstable}/{args.n}" + (" -- these should be excluded or investigated!" if n_unstable else ""))
    print(f"Manifest: {cfg.ML_DATA_DIR / 'manifest.json'}")


if __name__ == "__main__":
    main()
