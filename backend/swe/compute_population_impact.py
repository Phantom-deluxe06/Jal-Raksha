"""
Cross-references the real SWE flood-depth output against the real WorldPop
population raster and the real OSM settlement points, and writes the result
back into the SWE run's metadata.json (frames array) -- this is a
post-processing enrichment step over the existing, already-computed SWE
run; it does not re-run the solver.

Methodology (documented, not hidden):
- The population raster (~1km cells) is coarser than the SWE depth grid
  (~185m cells), so each frame's depth grid is resampled DOWN onto the
  population raster's exact grid using average resampling (same technique
  already used elsewhere in this project for cross-resolution raster work,
  e.g. scripts/fetch_dem.py). A population cell counts as "at risk" if its
  *mean* depth across the resample exceeds the threshold -- this avoids
  flagging an entire ~1km population cell as flooded just because a small
  corner of it got wet, at the cost of being a bit conservative (a
  partially-flooded population cell can still show as "affected" once its
  areal-mean depth crosses the threshold; small partial floods at a
  cell's edge may be undercounted).
- Two thresholds are reported: >=0.1m ("at risk", matches the SWE run's own
  flood-extent threshold) and >=0.3m ("significantly affected").
- Settlement exposure: real named OSM points (data/settlements/) tested for
  point-in-polygon membership against each frame's own flood-extent
  GeoJSON (already produced by run_kosi_swe.py) -- not a separate,
  potentially-inconsistent extent calculation.

Usage: .venv\\Scripts\\python.exe backend\\swe\\compute_population_impact.py
"""
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import reproject
from rasterio.enums import Resampling
from shapely.geometry import shape, Point

ROOT = Path(__file__).resolve().parent.parent.parent
RUN_DIR = Path(__file__).resolve().parent.parent / "outputs" / "swe_kosi_actual2008"
POP_PATH = ROOT / "data" / "population" / "kosi_aoi_worldpop_2020.tif"
SETTLEMENTS_PATH = ROOT / "data" / "settlements" / "kosi_aoi_settlements.geojson"

SIGNIFICANT_DEPTH_M = 0.3


def load_settlements():
    fc = json.loads(SETTLEMENTS_PATH.read_text())
    pts = []
    for f in fc["features"]:
        lon, lat = f["geometry"]["coordinates"]
        pts.append((f["properties"]["name"], f["properties"]["place_type"], Point(lon, lat)))
    return pts


def load_frame_polygons(geojson_path: Path):
    fc = json.loads(geojson_path.read_text())
    return [shape(f["geometry"]) for f in fc["features"]]


def main():
    meta_path = RUN_DIR / "metadata.json"
    meta = json.loads(meta_path.read_text())

    with rasterio.open(POP_PATH) as pop_src:
        pop = pop_src.read(1).astype(np.float64)
        pop = np.where(pop > 0, pop, 0.0)  # nodata/negative -> 0
        pop_transform = pop_src.transform
        pop_crs = pop_src.crs
        pop_shape = pop.shape

    settlements = load_settlements()
    print(f"Loaded population raster {pop_shape}, total AOI population ~{pop.sum():,.0f}")
    print(f"Loaded {len(settlements)} named settlements")

    for frame in meta["frames"]:
        tag = frame["depth_tif"].split("depth_")[1].replace(".tif", "")
        depth_path = RUN_DIR / frame["depth_tif"]

        with rasterio.open(depth_path) as src:
            depth_on_pop_grid = np.zeros(pop_shape, dtype=np.float32)
            reproject(
                source=rasterio.band(src, 1),
                destination=depth_on_pop_grid,
                src_transform=src.transform, src_crs=src.crs,
                dst_transform=pop_transform, dst_crs=pop_crs,
                resampling=Resampling.average,
                src_nodata=src.nodata, dst_nodata=0.0,
            )

        at_risk_mask = depth_on_pop_grid >= 0.1
        significant_mask = depth_on_pop_grid >= SIGNIFICANT_DEPTH_M
        pop_at_risk = float(pop[at_risk_mask].sum())
        pop_significant = float(pop[significant_mask].sum())

        extent_geojson_path = RUN_DIR / frame["geojson"]
        polygons = load_frame_polygons(extent_geojson_path)
        affected = []
        if polygons:
            for name, place_type, pt in settlements:
                if any(poly.contains(pt) for poly in polygons):
                    affected.append({"name": name, "place_type": place_type})

        frame["population_at_risk"] = round(pop_at_risk)
        frame["population_significantly_affected_gt0.3m"] = round(pop_significant)
        frame["affected_settlements"] = affected
        frame["affected_settlements_count"] = len(affected)

        print(f"[{tag}] pop_at_risk={pop_at_risk:,.0f}  significant(>0.3m)={pop_significant:,.0f}  "
              f"settlements={len(affected)}" + (f" ({', '.join(a['name'] for a in affected[:5])}{'...' if len(affected)>5 else ''})" if affected else ""))

    meta["population_impact_methodology"] = {
        "population_source": "data/population/kosi_aoi_worldpop_2020.tif (WorldPop India 2020, ~1km)",
        "settlement_source": "data/settlements/kosi_aoi_settlements.geojson (OpenStreetMap via Overpass API, 363 named places)",
        "method": (
            "Each frame's depth grid (~185m cells) is resampled via area-average onto the "
            "population raster's exact ~1km grid; a population cell counts as affected once "
            "its areal-mean depth crosses the threshold. Settlement exposure is a point-in-"
            "polygon test of real OSM place points against that frame's own flood-extent "
            "polygon (same one used for GeoJSON/Shapefile/KML export)."
        ),
        "at_risk_threshold_m": 0.1,
        "significant_threshold_m": SIGNIFICANT_DEPTH_M,
        "caveat": (
            "Areal-mean thresholding is conservative near a flood's edge: a population cell "
            "only partially covered by flooding may not cross the mean-depth threshold even "
            "though part of its population is genuinely exposed. Settlement points are place "
            "labels/centroids, not building footprints -- a settlement can be genuinely "
            "affected at its edges without its OSM point falling inside the mapped extent, or "
            "vice versa for a large settlement with an outlying centroid."
        ),
    }
    meta_path.write_text(json.dumps(meta, indent=2))
    print(f"\nUpdated: {meta_path}")


if __name__ == "__main__":
    main()
