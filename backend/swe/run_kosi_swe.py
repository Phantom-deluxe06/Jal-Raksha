"""
Run the SWE solver on the real Kosi AOI DEM using the ACTUAL 2008 Kusaha
breach discharge (not the barrage's theoretical design discharge), and write
out a time series of depth grids + web-friendly overlays + GIS exports +
a metadata/sanity-check report.

Usage: .venv\\Scripts\\python.exe backend\\swe\\run_kosi_swe.py
"""
import json
import shutil
import sys
import time
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from swe.dem_utils import load_dem_grid, latlon_to_rowcol
from swe.solver import BreachSource, SolverParams, run_swe
from swe.colorize import colorize_depth

ROOT = Path(__file__).resolve().parent.parent.parent
DEM_PATH = ROOT / "data" / "dem" / "kosi_aoi_srtm30m.tif"
CONFIG_PATH = ROOT / "data" / "dam_config" / "kosi_case_study.json"
OUT_DIR = Path(__file__).resolve().parent.parent / "outputs" / "swe_kosi_actual2008"

TARGET_RES_DEG = 0.0016667  # ~185m grid spacing (6x coarser than the 30m source DEM)
DURATION_S = 4 * 3600.0     # 4 hours simulated
SNAPSHOT_INTERVAL_S = 15 * 60.0  # 15 min
FLOOD_DEPTH_THRESHOLD_M = 0.1    # min depth counted as "flooded" for extent/area stats

SCENARIO_LABEL = "ACTUAL 2008 KUSAHA BREACH (documented discharge)"


def polygonize_flood(depth: np.ndarray, transform, crs, threshold: float):
    from rasterio.features import shapes as rio_shapes
    import geopandas as gpd
    from shapely.geometry import shape as shp_shape

    mask = (depth >= threshold).astype(np.uint8)
    geoms, vals = [], []
    for geom, val in rio_shapes(mask, mask=mask.astype(bool), transform=transform):
        if val == 1:
            geoms.append(shp_shape(geom))
            vals.append(val)
    if not geoms:
        return gpd.GeoDataFrame({"flooded": []}, geometry=[], crs=crs)
    gdf = gpd.GeoDataFrame({"flooded": vals}, geometry=geoms, crs=crs)
    return gdf


def main():
    t_wall_start = time.time()
    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    (OUT_DIR / "frames").mkdir(parents=True)
    (OUT_DIR / "overlays").mkdir(parents=True)
    (OUT_DIR / "geojson").mkdir(parents=True)
    (OUT_DIR / "export").mkdir(parents=True)

    config = json.loads(CONFIG_PATH.read_text())
    breach_cfg = config["structure"]["breach_site"]
    event = config["breach_event"]
    sim_defaults = config["simulation_defaults"]

    print(f"Loading DEM: {DEM_PATH}")
    grid = load_dem_grid(str(DEM_PATH), TARGET_RES_DEG)
    print(f"  grid: {grid.rows} x {grid.cols} cells, dx={grid.dx:.1f}m, dy={grid.dy:.1f}m")

    breach_row, breach_col = latlon_to_rowcol(grid, breach_cfg["coordinates"]["lat"], breach_cfg["coordinates"]["lon"])
    print(f"  breach site -> grid cell (row={breach_row}, col={breach_col})")

    discharge_cumecs = event["discharge_at_breach_cumecs"]
    print(f"\nScenario: {SCENARIO_LABEL}")
    print(f"  discharge = {discharge_cumecs} cumecs (source: breach_event.discharge_at_breach_cumecs, dated {event['date']})")
    print(f"  NOT using barrage design discharge ({config['structure']['barrage']['design_peak_discharge_cumecs']} cumecs) for this run.")

    breach = BreachSource(
        row=breach_row,
        col=breach_col,
        width_m=sim_defaults["breach_width_m"],
        peak_discharge_cumecs=discharge_cumecs,
        ramp_minutes=sim_defaults["breach_hydrograph_ramp_minutes"],
    )
    params = SolverParams()

    print(f"\nRunning SWE solver: duration={DURATION_S/3600:.1f}h, snapshot every {SNAPSHOT_INTERVAL_S/60:.0f}min...")
    result = run_swe(
        elevation=grid.elevation,
        dx=grid.dx,
        dy=grid.dy,
        breach=breach,
        duration_s=DURATION_S,
        snapshot_interval_s=SNAPSHOT_INTERVAL_S,
        params=params,
    )
    wall_s = time.time() - t_wall_start
    print(f"  done: {result.n_steps} timesteps, {len(result.depth_frames)} snapshots, {wall_s:.1f}s wall time")
    if result.unstable:
        print("  *** SOLVER FLAGGED UNSTABLE (NaN/blowup) -- results below this point are INVALID ***")

    cell_area_km2 = (grid.dx * grid.dy) / 1e6
    aoi_area_km2 = grid.rows * grid.cols * cell_area_km2

    frames_meta = []
    for i, (t_s, depth) in enumerate(zip(result.times_s, result.depth_frames)):
        t_min = round(t_s / 60)
        tag = f"t{t_min:04d}"

        tif_path = OUT_DIR / "frames" / f"depth_{tag}.tif"
        meta = dict(
            driver="GTiff", height=grid.rows, width=grid.cols, count=1,
            dtype="float32", crs=grid.crs, transform=grid.transform,
            nodata=-1.0, compress="DEFLATE",
        )
        with rasterio.open(tif_path, "w", **meta) as dst:
            dst.write(depth, 1)

        rgba = colorize_depth(depth, dry_threshold=FLOOD_DEPTH_THRESHOLD_M)
        png_path = OUT_DIR / "overlays" / f"depth_{tag}.png"
        Image.fromarray(rgba, mode="RGBA").save(png_path)

        flooded_cells = int((depth >= FLOOD_DEPTH_THRESHOLD_M).sum())
        flooded_km2 = flooded_cells * cell_area_km2

        gdf = polygonize_flood(depth, grid.transform, grid.crs, FLOOD_DEPTH_THRESHOLD_M)
        geojson_path = OUT_DIR / "geojson" / f"flood_extent_{tag}.geojson"
        gdf.to_file(geojson_path, driver="GeoJSON")

        frames_meta.append(dict(
            t_minutes=t_min,
            t_seconds=t_s,
            depth_tif=f"frames/depth_{tag}.tif",
            overlay_png=f"overlays/depth_{tag}.png",
            geojson=f"geojson/flood_extent_{tag}.geojson",
            flooded_area_km2=round(flooded_km2, 3),
            max_depth_m=round(float(depth.max()), 3),
            mean_wet_depth_m=round(float(depth[depth >= FLOOD_DEPTH_THRESHOLD_M].mean()), 3) if flooded_cells else 0.0,
        ))
        print(f"  [{tag}] t={t_min}min  flooded={flooded_km2:.2f}km2  max_depth={depth.max():.2f}m")

    # Max-extent export (union of flooding across the whole run) -- the most
    # useful single layer for GIS export / "final flood footprint" display.
    max_gdf = polygonize_flood(result.max_depth, grid.transform, grid.crs, FLOOD_DEPTH_THRESHOLD_M)
    export_geojson = OUT_DIR / "export" / "flood_extent_max.geojson"
    max_gdf.to_file(export_geojson, driver="GeoJSON")

    export_shp = OUT_DIR / "export" / "flood_extent_max.shp"
    if len(max_gdf):
        max_gdf.to_file(export_shp, driver="ESRI Shapefile")

    export_kml = OUT_DIR / "export" / "flood_extent_max.kml"
    if len(max_gdf):
        import simplekml
        kml = simplekml.Kml()
        for geom in max_gdf.geometry:
            polys = [geom] if geom.geom_type == "Polygon" else list(geom.geoms)
            for poly in polys:
                kml.newpolygon(outerboundaryis=list(poly.exterior.coords))
        kml.save(str(export_kml))

    max_flooded_cells = int((result.max_depth >= FLOOD_DEPTH_THRESHOLD_M).sum())
    max_flooded_km2 = max_flooded_cells * cell_area_km2
    final_volume_m3 = float(result.depth_frames[-1].astype(np.float64).sum() * grid.dx * grid.dy)

    # --- Sanity checks (explicitly flagged, not silently accepted) ---
    historical_km2 = event["outcome"]["inundated_area_km2"]
    aoi_frac = max_flooded_km2 / aoi_area_km2 if aoi_area_km2 else 0

    checks = []

    mass_delta_pct = (final_volume_m3 - result.injected_volume_m3) / result.injected_volume_m3 * 100 if result.injected_volume_m3 else 0
    mass_ok = abs(mass_delta_pct) <= 2.0  # numerical slack for the explicit LF scheme's source-term splitting
    checks.append(dict(
        name="mass_conservation",
        pass_=bool(mass_ok),
        detail=(
            f"volume on grid at final step ({final_volume_m3:,.0f} m3) vs. total volume "
            f"injected by the breach hydrograph ({result.injected_volume_m3:,.0f} m3): "
            f"{mass_delta_pct:+.2f}% delta. Water can only leave via open boundaries, never "
            f"be created, so grid volume should be <= injected volume; a small positive delta "
            f"here is expected numerical-scheme error (operator-split source terms are not "
            f"exactly flux-conservative), not mass creation from nothing. "
            f"{'WARNING: delta exceeds the 2% tolerance -- investigate.' if not mass_ok else ''}"
        ),
    ))

    extent_trivial = aoi_frac < 0.005
    checks.append(dict(
        name="nontrivial_flood_extent",
        pass_=not extent_trivial,
        detail=(
            f"simulated max flood extent is {aoi_frac*100:.2f}% of the AOI "
            f"({max_flooded_km2:.1f} km2 of {aoi_area_km2:.1f} km2). "
            f"{'WARNING: essentially no flooding propagated -- check breach placement/discharge.' if extent_trivial else 'non-trivial extent, OK.'}"
        ),
    ))

    extent_saturated = aoi_frac > 0.95
    checks.append(dict(
        name="extent_not_saturated",
        pass_=not extent_saturated,
        detail=(
            f"simulated max flood extent is {aoi_frac*100:.2f}% of the AOI. "
            f"{'WARNING: flood covers nearly the entire AOI -- likely numerical instability or runaway source term, not a physical result.' if extent_saturated else 'OK, not saturating the domain.'}"
        ),
    ))

    checks.append(dict(
        name="historical_context_only",
        pass_=None,
        detail=(
            f"Historical 2008 event: ~{historical_km2} km2 flooded across 5 Bihar districts "
            f"(far larger area than this AOI, which was deliberately scoped down to "
            f"{aoi_area_km2:.0f} km2 around the breach site for compute tractability -- see "
            f"data/dam_config/kosi_case_study.json). This simulation's {max_flooded_km2:.1f} km2 "
            f"is NOT directly comparable to 3700 km2 and is expected to be smaller by design. "
            f"This check is context only, not a pass/fail validation."
        ),
    ))

    checks.append(dict(
        name="solver_stability",
        pass_=not result.unstable,
        detail="solver reported NaN/blowup mid-run" if result.unstable else "no instability flagged",
    ))

    print("\n=== SANITY CHECKS ===")
    for c in checks:
        status = "N/A (context)" if c["pass_"] is None else ("PASS" if c["pass_"] else "*** FAIL/WARNING ***")
        print(f"[{status}] {c['name']}: {c['detail']}")

    metadata = dict(
        scenario_label=SCENARIO_LABEL,
        scenario_discharge_source="breach_event.discharge_at_breach_cumecs (actual documented 2008 breach flow)",
        discharge_cumecs=discharge_cumecs,
        design_discharge_cumecs_NOT_USED=config["structure"]["barrage"]["design_peak_discharge_cumecs"],
        breach_latlon=breach_cfg["coordinates"],
        breach_grid_cell=[breach_row, breach_col],
        breach_width_m=sim_defaults["breach_width_m"],
        breach_hydrograph_ramp_minutes=sim_defaults["breach_hydrograph_ramp_minutes"],
        grid=dict(rows=grid.rows, cols=grid.cols, dx_m=grid.dx, dy_m=grid.dy, target_res_deg=TARGET_RES_DEG),
        solver=dict(
            scheme="explicit 2D Lax-Friedrichs finite-volume, point-implicit Manning friction",
            manning_n=params.manning_n,
            cfl=params.cfl,
            flood_depth_threshold_m=FLOOD_DEPTH_THRESHOLD_M,
            duration_s=DURATION_S,
            snapshot_interval_s=SNAPSHOT_INTERVAL_S,
            n_steps=result.n_steps,
            wall_time_s=round(wall_s, 1),
            unstable=result.unstable,
        ),
        bounds=dict(zip(["west", "south", "east", "north"], rasterio.transform.array_bounds(grid.rows, grid.cols, grid.transform))),
        aoi_area_km2=round(aoi_area_km2, 1),
        max_flooded_area_km2=round(max_flooded_km2, 2),
        max_depth_m=round(float(result.max_depth.max()), 2),
        injected_volume_m3=round(result.injected_volume_m3, 0),
        final_grid_volume_m3=round(final_volume_m3, 0),
        historical_reference=dict(
            inundated_area_km2=historical_km2,
            note="Full multi-district 2008 event; not directly comparable to this AOI-scoped simulation. See sanity_checks.historical_context_only.",
        ),
        frames=frames_meta,
        sanity_checks=checks,
        assumptions=[
            f"Manning's n = {params.manning_n} uniform (rural/agricultural floodplain, not field-measured)",
            f"Breach hydrograph: linear ramp 0->peak over {sim_defaults['breach_hydrograph_ramp_minutes']} min, then held at peak (no historical hydrograph documented)",
            f"Breach location is approximate (see data/dam_config/kosi_case_study.json breach_site.coordinates_note)",
            f"Breach width {sim_defaults['breach_width_m']}m is a plausible placeholder, not a documented historical value",
            "Domain boundaries are open/zero-gradient on all sides (water can exit the AOI freely)",
            "Pre-breach river channel treated as dry (h=0) initial condition -- simulating only the breach floodwater, not baseflow",
            f"Grid resolution downsampled to ~{grid.dx:.0f}m x {grid.dy:.0f}m from the native 30m DEM for compute tractability",
        ],
    )
    (OUT_DIR / "metadata.json").write_text(json.dumps(metadata, indent=2, default=str))
    print(f"\nOutputs written to: {OUT_DIR}")
    print(f"metadata.json: {OUT_DIR / 'metadata.json'}")


if __name__ == "__main__":
    main()
