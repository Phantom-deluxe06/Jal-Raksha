"""
Cross-references the real SWE flood-depth output against the real WorldPop
population raster and the real OSM settlement points using the Flood Impact Analysis Engine.
Updates metadata.json and generates impact_analysis.json.

Usage: python backend/swe/compute_population_impact.py
"""
import json
import sys
from pathlib import Path

import numpy as np
import rasterio

ROOT = Path(__file__).resolve().parent.parent.parent
BACKEND_DIR = Path(__file__).resolve().parent.parent
RUN_DIR = BACKEND_DIR / "outputs" / "swe_kosi_actual2008"
POP_PATH = ROOT / "data" / "population" / "kosi_aoi_worldpop_2020.tif"
SETTLEMENTS_PATH = ROOT / "data" / "settlements" / "kosi_aoi_settlements.geojson"

sys.path.insert(0, str(BACKEND_DIR))
from swe.impact_engine import run_impact_analysis


def main():
    meta_path = RUN_DIR / "metadata.json"
    if not meta_path.exists():
        print(f"Error: {meta_path} does not exist. Run the SWE simulation first.")
        return

    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    frames = meta.get("frames", [])
    if not frames:
        print("No frames found in metadata.")
        return

    times_s = []
    depth_frames = []

    grid_transform = None
    grid_crs = None
    grid_dx = meta.get("grid", {}).get("dx_m", 166.33)
    grid_dy = meta.get("grid", {}).get("dy_m", 185.54)

    for f in frames:
        times_s.append(f.get("t_seconds", f.get("t_minutes", 0) * 60.0))
        depth_tif = RUN_DIR / f["depth_tif"]
        with rasterio.open(depth_tif) as src:
            depth_frames.append(src.read(1))
            if grid_transform is None:
                grid_transform = src.transform
                grid_crs = src.crs

    max_depth = np.maximum.reduce(depth_frames)

    print(f"Running impact analysis across {len(depth_frames)} timesteps on {RUN_DIR.name}...")
    impact_report = run_impact_analysis(
        times_s=times_s,
        depth_frames=depth_frames,
        max_depth=max_depth,
        grid_transform=grid_transform,
        grid_crs=grid_crs,
        grid_dx=grid_dx,
        grid_dy=grid_dy,
        pop_path=POP_PATH,
        settlements_path=SETTLEMENTS_PATH,
    )

    # Update frames in metadata
    for i, t_impact in enumerate(impact_report["timeline_frames"]):
        meta["frames"][i]["population_at_risk"] = t_impact["population_potentially_exposed"]
        meta["frames"][i]["population_significantly_affected_gt0.3m"] = t_impact["population_significantly_affected_gt0.3m"]
        meta["frames"][i]["affected_settlements"] = t_impact["exposed_settlements"]
        meta["frames"][i]["affected_settlements_count"] = t_impact["settlements_potentially_exposed_count"]

    meta["impact_analysis"] = impact_report
    meta["population_impact_methodology"] = impact_report["methodology"]

    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    impact_json_path = RUN_DIR / "impact_analysis.json"
    impact_json_path.write_text(json.dumps(impact_report, indent=2), encoding="utf-8")

    print(f"Successfully updated {meta_path}")
    print(f"Generated {impact_json_path}")
    print(f"  Total settlements potentially exposed: {impact_report['summary']['settlements_potentially_exposed_count']}")
    print(f"  Max population potentially exposed: {impact_report['summary']['max_population_potentially_exposed']:,}")


if __name__ == "__main__":
    main()
