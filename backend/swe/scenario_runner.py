"""
Scenario simulation runner for FloodSim-HADR.
Executes 2D Shallow Water Equations simulation based on a parameterized scenario configuration,
generates GeoTIFFs, PNG overlays, GeoJSON polygons, GIS exports (Shapefile, KML),
and runs the full Flood Impact Analysis Engine.
"""
import argparse
import json
import shutil
import sys
import time
from pathlib import Path
from typing import Any, Callable, Dict, Optional

import numpy as np
import rasterio
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent.parent
BACKEND_DIR = Path(__file__).resolve().parent.parent
DEM_DEFAULT_PATH = ROOT / "data" / "dem" / "kosi_aoi_srtm30m.tif"
KOSI_CONFIG_PATH = ROOT / "data" / "dam_config" / "kosi_case_study.json"
POP_PATH = ROOT / "data" / "population" / "kosi_aoi_worldpop_2020.tif"
SETTLEMENTS_PATH = ROOT / "data" / "settlements" / "kosi_aoi_settlements.geojson"
OUTPUTS_DIR = BACKEND_DIR / "outputs"

sys.path.insert(0, str(BACKEND_DIR))
from swe.dem_utils import load_dem_grid, latlon_to_rowcol
from swe.solver import BreachSource, SolverParams, run_swe
from swe.colorize import colorize_depth
from swe.impact_engine import run_impact_analysis

TARGET_RES_DEG = 0.0016667  # ~185m grid spacing
FLOOD_DEPTH_THRESHOLD_M = 0.1  # min depth counted as flooded
SIGNIFICANT_DEPTH_M = 0.3


def get_default_kosi_scenario() -> Dict[str, Any]:
    """Returns the reference Kosi 2008 historical scenario configuration."""
    kosi_data = {}
    if KOSI_CONFIG_PATH.exists():
        kosi_data = json.loads(KOSI_CONFIG_PATH.read_text(encoding="utf-8"))

    breach_cfg = kosi_data.get("structure", {}).get("breach_site", {})
    breach_coords = breach_cfg.get("coordinates", {"lat": 26.62, "lon": 87.05})
    event = kosi_data.get("breach_event", {})
    sim_defaults = kosi_data.get("simulation_defaults", {})

    return {
        "metadata": {
            "scenario_id": "kosi_actual2008",
            "name": "Kosi 2008 — Historical Validation",
            "scenario_type": "historical",
            "event_type": "embankment_failure",
            "event_type_label": "Embankment Failure",
            "description": "Documented 18 Aug 2008 Kusaha afflux embankment breach on the Kosi River (Bihar flood). Reference validation case.",
            "author": "FloodSim Reference Suite",
            "created_at": "2008-08-18",
        },
        "studyArea": {
            "name": "Kosi River Basin (North Bihar / Sunsari AOI)",
            "river_name": "Kosi (Koshi) River",
            "basin": "Kosi Basin, Ganga Sub-basin",
            "dem_file": "data/dem/kosi_aoi_srtm30m.tif",
            "bounds": {
                "west": 86.6,
                "south": 25.9,
                "east": 87.3,
                "north": 26.7,
            },
        },
        "dam": {
            "name": "Kusaha Eastern Afflux Embankment",
            "structure_type": "embankment_breach",
            "barrage_name": "Kosi Barrage (Bhimnagar Barrage)",
            "barrage_coordinates": {"lat": 26.5263, "lon": 86.9269},
        },
        "breach": {
            "site_name": "Kusaha Breach Site",
            "coordinates": breach_coords,
            "width_m": float(sim_defaults.get("breach_width_m", 100)),
            "ramp_minutes": float(sim_defaults.get("breach_hydrograph_ramp_minutes", 30)),
        },
        "initialConditions": {
            "bed_condition": "dry_bed",
            "initial_depth_m": 0.0,
        },
        "waterConditions": {
            "peak_discharge_cumecs": float(event.get("discharge_at_breach_cumecs", 3675)),
            "discharge_source": "breach_event.discharge_at_breach_cumecs (actual documented 2008 breach flow)",
            "design_discharge_cumecs_NOT_USED": float(kosi_data.get("structure", {}).get("barrage", {}).get("design_peak_discharge_cumecs", 27000)),
        },
        "simulation": {
            "duration_hours": 4.0,
            "snapshot_interval_minutes": 15.0,
            "target_resolution_deg": TARGET_RES_DEG,
            "manning_n": 0.035,
            "cfl": 0.4,
            "flood_depth_threshold_m": FLOOD_DEPTH_THRESHOLD_M,
        },
    }


def polygonize_flood(depth: np.ndarray, transform, crs, threshold: float):
    """Vectorize flooded raster areas into GeoDataFrame polygons."""
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
    return gpd.GeoDataFrame({"flooded": vals}, geometry=geoms, crs=crs)


def execute_scenario(
    scenario_cfg: Dict[str, Any],
    status_callback: Optional[Callable[[str, str], None]] = None,
) -> Dict[str, Any]:
    """
    Executes the SWE solver pipeline according to the given scenario configuration.
    Writes outputs into outputs/swe_<scenario_id>.
    """
    t_wall_start = time.time()

    def update_status(st: str, msg: str = ""):
        if status_callback:
            status_callback(st, msg)
        print(f"[{st.upper()}] {msg}")

    update_status("running", "Validating parameters and loading topographical DEM...")

    meta_cfg = scenario_cfg.get("metadata", {})
    scenario_id = meta_cfg.get("scenario_id", f"custom_{int(time.time())}")
    scenario_name = meta_cfg.get("name", "Custom Simulation Scenario")
    scenario_type = meta_cfg.get("scenario_type", "custom_dam_break")
    _EVENT_TYPE_LABELS = {
        "dam_break": "Dam Break",
        "river_blockage": "River Blockage / Natural Lake Breach",
        "controlled_release": "Controlled Release",
        "embankment_failure": "Embankment Failure",
    }
    event_type = meta_cfg.get("event_type", "embankment_failure")
    event_type_label = meta_cfg.get("event_type_label") or _EVENT_TYPE_LABELS.get(
        event_type, event_type.replace("_", " ").title()
    )

    # Output directory naming: preserve swe_kosi_actual2008 for historical case
    if scenario_id in ("kosi_actual2008", "kosi_2008_historical"):
        out_dir = OUTPUTS_DIR / "swe_kosi_actual2008"
    else:
        out_dir = OUTPUTS_DIR / f"swe_{scenario_id}"

    if out_dir.exists():
        shutil.rmtree(out_dir)
    (out_dir / "frames").mkdir(parents=True, exist_ok=True)
    (out_dir / "overlays").mkdir(parents=True, exist_ok=True)
    (out_dir / "geojson").mkdir(parents=True, exist_ok=True)
    (out_dir / "export").mkdir(parents=True, exist_ok=True)

    # Resolve DEM path
    study_cfg = scenario_cfg.get("studyArea", {})
    dem_rel = study_cfg.get("dem_file", "data/dem/kosi_aoi_srtm30m.tif")
    dem_path = ROOT / dem_rel if not Path(dem_rel).is_absolute() else Path(dem_rel)
    if not dem_path.exists():
        dem_path = DEM_DEFAULT_PATH

    sim_cfg = scenario_cfg.get("simulation", {})
    res_deg = float(sim_cfg.get("target_resolution_deg", TARGET_RES_DEG))
    duration_hours = float(sim_cfg.get("duration_hours", 4.0))
    duration_s = max(600.0, duration_hours * 3600.0)
    snap_interval_min = float(sim_cfg.get("snapshot_interval_minutes", 15.0))
    snapshot_interval_s = max(60.0, snap_interval_min * 60.0)
    manning_n = float(sim_cfg.get("manning_n", 0.035))
    cfl = float(sim_cfg.get("cfl", 0.4))
    depth_thresh = float(sim_cfg.get("flood_depth_threshold_m", FLOOD_DEPTH_THRESHOLD_M))

    grid = load_dem_grid(str(dem_path), res_deg)
    bounds_dict = dict(zip(["west", "south", "east", "north"], rasterio.transform.array_bounds(grid.rows, grid.cols, grid.transform)))

    # Resolve Breach coordinates
    breach_cfg = scenario_cfg.get("breach", {})
    coords = breach_cfg.get("coordinates", {"lat": 26.62, "lon": 87.05})
    lat, lon = float(coords.get("lat", 26.62)), float(coords.get("lon", 87.05))

    # Clamp coordinates to DEM bounds
    lat = max(bounds_dict["south"] + 0.01, min(bounds_dict["north"] - 0.01, lat))
    lon = max(bounds_dict["west"] + 0.01, min(bounds_dict["east"] - 0.01, lon))

    breach_row, breach_col = latlon_to_rowcol(grid, lat, lon)
    breach_elev = float(grid.elevation[breach_row, breach_col])

    # Water conditions
    water_cfg = scenario_cfg.get("waterConditions", {})
    discharge_cumecs = float(water_cfg.get("peak_discharge_cumecs", 3675.0))
    breach_width_m = float(breach_cfg.get("width_m", 100.0))
    ramp_minutes = float(breach_cfg.get("ramp_minutes", 30.0))

    breach_source = BreachSource(
        row=breach_row,
        col=breach_col,
        width_m=breach_width_m,
        peak_discharge_cumecs=discharge_cumecs,
        ramp_minutes=ramp_minutes,
    )
    solver_params = SolverParams(
        manning_n=manning_n,
        cfl=cfl,
    )

    update_status("running", f"Running SWE solver: {duration_hours:.1f}h simulated, {discharge_cumecs:,.0f} m³/s discharge...")

    # Run SWE Solver
    result = run_swe(
        elevation=grid.elevation,
        dx=grid.dx,
        dy=grid.dy,
        breach=breach_source,
        duration_s=duration_s,
        snapshot_interval_s=snapshot_interval_s,
        params=solver_params,
    )

    update_status("processing", "Generating GeoTIFFs, colorized overlays, vector extents, and running Impact Engine...")

    cell_area_km2 = (grid.dx * grid.dy) / 1e6
    aoi_area_km2 = grid.rows * grid.cols * cell_area_km2

    # 4. Run Impact Engine for time-dependent settlement exposure and zonal population
    impact_report = run_impact_analysis(
        times_s=result.times_s,
        depth_frames=result.depth_frames,
        max_depth=result.max_depth,
        grid_transform=grid.transform,
        grid_crs=grid.crs,
        grid_dx=grid.dx,
        grid_dy=grid.dy,
        pop_path=POP_PATH,
        settlements_path=SETTLEMENTS_PATH,
    )

    frames_meta = []
    for i, (t_s, depth) in enumerate(zip(result.times_s, result.depth_frames)):
        u = result.u_frames[i]
        v = result.v_frames[i]
        t_min = round(t_s / 60)
        tag = f"t{t_min:04d}"

        # Write Depth GeoTIFF
        tif_path = out_dir / "frames" / f"depth_{tag}.tif"
        meta_tiff = dict(
            driver="GTiff", height=grid.rows, width=grid.cols, count=1,
            dtype="float32", crs=grid.crs, transform=grid.transform,
            nodata=-1.0, compress="DEFLATE",
        )
        with rasterio.open(tif_path, "w", **meta_tiff) as dst:
            dst.write(depth, 1)

        # Write u, v velocity GeoTIFFs
        u_tif_path = out_dir / "frames" / f"u_{tag}.tif"
        with rasterio.open(u_tif_path, "w", **meta_tiff) as dst:
            dst.write(u, 1)

        v_tif_path = out_dir / "frames" / f"v_{tag}.tif"
        with rasterio.open(v_tif_path, "w", **meta_tiff) as dst:
            dst.write(v, 1)

        # Write colorized RGBA PNG
        rgba = colorize_depth(depth, dry_threshold=depth_thresh)
        png_path = out_dir / "overlays" / f"depth_{tag}.png"
        Image.fromarray(rgba, mode="RGBA").save(png_path)

        flooded_cells = int((depth >= depth_thresh).sum())
        flooded_km2 = flooded_cells * cell_area_km2

        # Write GeoJSON extent
        gdf = polygonize_flood(depth, grid.transform, grid.crs, depth_thresh)
        geojson_path = out_dir / "geojson" / f"flood_extent_{tag}.geojson"
        gdf.to_file(geojson_path, driver="GeoJSON")

        # Get matched frame impact metrics from impact_report
        t_impact = impact_report["timeline_frames"][i]

        frames_meta.append(dict(
            t_minutes=t_min,
            t_seconds=t_s,
            depth_tif=f"frames/depth_{tag}.tif",
            u_tif=f"frames/u_{tag}.tif",
            v_tif=f"frames/v_{tag}.tif",
            overlay_png=f"overlays/depth_{tag}.png",
            geojson=f"geojson/flood_extent_{tag}.geojson",
            flooded_area_km2=round(flooded_km2, 3),
            max_depth_m=round(float(depth.max()), 3),
            mean_wet_depth_m=round(float(depth[depth >= depth_thresh].mean()), 3) if flooded_cells else 0.0,
            population_at_risk=t_impact["population_potentially_exposed"],
            **{"population_significantly_affected_gt0.3m": t_impact["population_significantly_affected_gt0.3m"]},
            affected_settlements=t_impact["exposed_settlements"],
            affected_settlements_count=t_impact["settlements_potentially_exposed_count"],
        ))

    # Union maximum extent export
    max_gdf = polygonize_flood(result.max_depth, grid.transform, grid.crs, depth_thresh)
    export_geojson = out_dir / "export" / "flood_extent_max.geojson"
    max_gdf.to_file(export_geojson, driver="GeoJSON")

    export_shp = out_dir / "export" / "flood_extent_max.shp"
    if len(max_gdf):
        max_gdf.to_file(export_shp, driver="ESRI Shapefile")

    export_kml = out_dir / "export" / "flood_extent_max.kml"
    if len(max_gdf):
        try:
            import simplekml
            kml = simplekml.Kml()
            for geom in max_gdf.geometry:
                polys = [geom] if geom.geom_type == "Polygon" else list(geom.geoms)
                for poly in polys:
                    kml.newpolygon(outerboundaryis=list(poly.exterior.coords))
            kml.save(str(export_kml))
        except Exception as e:
            print(f"Warning: KML export error: {e}")

    max_flooded_cells = int((result.max_depth >= depth_thresh).sum())
    max_flooded_km2 = max_flooded_cells * cell_area_km2
    final_volume_m3 = float(result.depth_frames[-1].astype(np.float64).sum() * grid.dx * grid.dy)

    # Sanity checks
    aoi_frac = max_flooded_km2 / aoi_area_km2 if aoi_area_km2 else 0
    checks = []

    mass_delta_pct = (final_volume_m3 - result.injected_volume_m3) / result.injected_volume_m3 * 100 if result.injected_volume_m3 else 0
    mass_ok = abs(mass_delta_pct) <= 2.5
    checks.append(dict(
        name="mass_conservation",
        pass_=bool(mass_ok),
        detail=(
            f"Volume on grid at final step ({final_volume_m3:,.0f} m³) vs. total volume injected "
            f"({result.injected_volume_m3:,.0f} m³): {mass_delta_pct:+.2f}% delta."
        ),
    ))

    extent_trivial = aoi_frac < 0.002
    checks.append(dict(
        name="nontrivial_flood_extent",
        pass_=not extent_trivial,
        detail=f"Simulated max flood extent is {aoi_frac*100:.2f}% of AOI ({max_flooded_km2:.1f} km²).",
    ))

    extent_saturated = aoi_frac > 0.95
    checks.append(dict(
        name="extent_not_saturated",
        pass_=not extent_saturated,
        detail=f"Simulated max flood extent is {aoi_frac*100:.2f}% of the AOI. Domain is not saturated.",
    ))

    checks.append(dict(
        name="solver_stability",
        pass_=not result.unstable,
        detail="Solver reported numerical blowup/NaN" if result.unstable else "No numerical instability flagged.",
    ))

    if scenario_type == "historical":
        checks.append(dict(
            name="historical_context_only",
            pass_=None,
            detail=(
                "Historical 2008 event: ~3700 km² flooded across 5 North Bihar districts. "
                f"This simulation's {max_flooded_km2:.1f} km² is scoped to the breach AOI ({aoi_area_km2:.0f} km²)."
            ),
        ))

    wall_s = time.time() - t_wall_start

    metadata = dict(
        scenario_id=scenario_id,
        scenario_label=scenario_name,
        scenario_type=scenario_type,
        event_type=event_type,
        event_type_label=event_type_label,
        scenario_description=meta_cfg.get("description", ""),
        discharge_cumecs=discharge_cumecs,
        design_discharge_cumecs_NOT_USED=water_cfg.get("design_discharge_cumecs_NOT_USED", 27000),
        breach_latlon={"lat": lat, "lon": lon},
        breach_elevation_m=round(breach_elev, 2),
        breach_grid_cell=[breach_row, breach_col],
        breach_width_m=breach_width_m,
        breach_hydrograph_ramp_minutes=ramp_minutes,
        grid=dict(rows=grid.rows, cols=grid.cols, dx_m=grid.dx, dy_m=grid.dy, target_res_deg=res_deg),
        solver=dict(
            scheme="explicit 2D Lax-Friedrichs finite-volume, point-implicit Manning friction",
            manning_n=manning_n,
            cfl=cfl,
            flood_depth_threshold_m=depth_thresh,
            duration_s=duration_s,
            snapshot_interval_s=snapshot_interval_s,
            n_steps=result.n_steps,
            wall_time_s=round(wall_s, 1),
            unstable=result.unstable,
        ),
        bounds=bounds_dict,
        aoi_area_km2=round(aoi_area_km2, 1),
        max_flooded_area_km2=round(max_flooded_km2, 2),
        max_depth_m=round(float(result.max_depth.max()), 2),
        injected_volume_m3=round(result.injected_volume_m3, 0),
        final_grid_volume_m3=round(final_volume_m3, 0),
        frames=frames_meta,
        sanity_checks=checks,
        assumptions=[
            f"Manning's n = {manning_n} uniform roughness across the domain",
            f"Inflow hydrograph: linear ramp 0 -> peak over {ramp_minutes} min, then held at peak discharge ({discharge_cumecs} m³/s)",
            f"Breach location ({lat:.4f}°N, {lon:.4f}°E), bed elevation sampled at {breach_elev:.1f}m",
            "Open (zero-gradient) boundary conditions on all domain boundaries",
            "Dry-bed initial condition (h=0m) representing floodwater advancement over terrain",
            f"SRTM DEM resampled to ~{grid.dx:.0f}m x {grid.dy:.0f}m grid for computational stability and performance",
        ],
        impact_analysis=impact_report,
        population_impact_methodology=impact_report["methodology"],
        scenario_config=scenario_cfg,
    )

    metadata_path = out_dir / "metadata.json"
    metadata_path.write_text(json.dumps(metadata, indent=2, default=str), encoding="utf-8")

    # Also save dedicated impact_analysis.json for fast direct access
    impact_json_path = out_dir / "impact_analysis.json"
    impact_json_path.write_text(json.dumps(impact_report, indent=2, default=str), encoding="utf-8")

    update_status("complete", f"Simulation & Impact Analysis completed in {wall_s:.1f}s. Outputs written to {out_dir.name}.")
    return metadata


def main():
    parser = argparse.ArgumentParser(description="Run parameterized SWE scenario simulation.")
    parser.add_argument("--config", type=str, help="Path to scenario JSON config file.")
    parser.add_argument("--scenario-id", type=str, default=None, help="Scenario identifier override.")
    args = parser.parse_args()

    if args.config and Path(args.config).exists():
        cfg = json.loads(Path(args.config).read_text(encoding="utf-8"))
    else:
        cfg = get_default_kosi_scenario()

    if args.scenario_id:
        cfg.setdefault("metadata", {})["scenario_id"] = args.scenario_id

    execute_scenario(cfg)


if __name__ == "__main__":
    main()
