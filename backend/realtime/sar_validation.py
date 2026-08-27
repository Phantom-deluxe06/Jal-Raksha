"""
Spatial Comparison and Validation Engine: Model vs Sentinel-1 Satellite Observation.

Performs spatial intersection, symmetric difference, and zonal validation metrics
(Intersection Area, Sim-Only, Obs-Only, IoU, Precision, Recall) between
simulated SWE flood extents and real Sentinel-1 SAR-derived water extents.
"""
from typing import Dict, Any, Optional
import json
from pathlib import Path

from shapely.geometry import shape, mapping
from shapely.ops import unary_union
from shapely.validation import make_valid
import pyproj

GEOD = pyproj.Geod(ellps="WGS84")


def _calc_geodesic_area_km2(geom) -> float:
    """Calculate exact geodesic surface area in km² on the WGS84 ellipsoid."""
    if geom is None or geom.is_empty:
        return 0.0
    try:
        area_m2, _ = GEOD.geometry_area_perimeter(geom)
        return round(abs(area_m2) / 1e6, 3)
    except Exception:
        return 0.0


def _extract_union_geom(geojson_data: Any):
    """Extract and union all polygon geometries from a GeoJSON FeatureCollection, Feature, or Geometry."""
    if not geojson_data:
        return None

    if isinstance(geojson_data, str):
        geojson_data = json.loads(geojson_data)

    geoms = []
    if isinstance(geojson_data, dict):
        if geojson_data.get("type") == "FeatureCollection":
            for f in geojson_data.get("features", []):
                g = f.get("geometry")
                if g:
                    s = make_valid(shape(g))
                    if not s.is_empty:
                        geoms.append(s)
        elif geojson_data.get("type") == "Feature":
            g = geojson_data.get("geometry")
            if g:
                s = make_valid(shape(g))
                if not s.is_empty:
                    geoms.append(s)
        elif "coordinates" in geojson_data:
            s = make_valid(shape(geojson_data))
            if not s.is_empty:
                geoms.append(s)

    if not geoms:
        return None

    unioned = unary_union(geoms)
    return make_valid(unioned)


def compare_model_and_observation(
    sim_geojson: Any,
    obs_geojson: Any,
    scenario_label: str = "ACTUAL 2008 KUSAHA BREACH",
    timestep_label: str = "Maximum Modeled Extent",
    sar_metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Perform spatial comparison between SWE model extent and SAR observed water extent."""
    geom_sim = _extract_union_geom(sim_geojson)
    geom_obs = _extract_union_geom(obs_geojson)

    area_sim = _calc_geodesic_area_km2(geom_sim)
    area_obs = _calc_geodesic_area_km2(geom_obs)

    if geom_sim is None or geom_sim.is_empty:
        geom_intersect = None
        geom_sim_only = None
        geom_obs_only = geom_obs
        geom_union = geom_obs
    elif geom_obs is None or geom_obs.is_empty:
        geom_intersect = None
        geom_sim_only = geom_sim
        geom_obs_only = None
        geom_union = geom_sim
    else:
        try:
            geom_intersect = make_valid(geom_sim.intersection(geom_obs))
        except Exception:
            geom_intersect = None

        try:
            geom_sim_only = make_valid(geom_sim.difference(geom_obs))
        except Exception:
            geom_sim_only = geom_sim

        try:
            geom_obs_only = make_valid(geom_obs.difference(geom_sim))
        except Exception:
            geom_obs_only = geom_obs

        try:
            geom_union = make_valid(geom_sim.union(geom_obs))
        except Exception:
            geom_union = None

    area_intersect = _calc_geodesic_area_km2(geom_intersect)
    area_sim_only = _calc_geodesic_area_km2(geom_sim_only)
    area_obs_only = _calc_geodesic_area_km2(geom_obs_only)
    area_union = _calc_geodesic_area_km2(geom_union) or (area_sim + area_obs - area_intersect)

    iou = round(area_intersect / area_union, 4) if area_union > 0 else 0.0
    precision = round(area_intersect / area_sim, 4) if area_sim > 0 else 0.0
    recall = round(area_intersect / area_obs, 4) if area_obs > 0 else 0.0

    # Build categorized GeoJSON difference layer
    features = []

    if geom_intersect and not geom_intersect.is_empty:
        features.append({
            "type": "Feature",
            "geometry": mapping(geom_intersect),
            "properties": {
                "category": "agreement",
                "label": "Model & SAR Observation Agreement",
                "description": "Area flooded in SWE simulation and confirmed by SAR backscatter.",
                "area_km2": area_intersect,
                "fill": "#3ddc97",
                "stroke": "#2bb879",
            },
        })

    if geom_sim_only and not geom_sim_only.is_empty:
        features.append({
            "type": "Feature",
            "geometry": mapping(geom_sim_only),
            "properties": {
                "category": "simulated_only",
                "label": "Simulated Inundation Only",
                "description": "Model-predicted flood corridor not detected as open water in recent SAR pass.",
                "area_km2": area_sim_only,
                "fill": "#4a90ff",
                "stroke": "#2f6fe0",
            },
        })

    if geom_obs_only and not geom_obs_only.is_empty:
        features.append({
            "type": "Feature",
            "geometry": mapping(geom_obs_only),
            "properties": {
                "category": "observed_only",
                "label": "SAR Observed Water Only",
                "description": "Current active river channel or wetland detected by SAR outside the breach flood corridor.",
                "area_km2": area_obs_only,
                "fill": "#ff9f1c",
                "stroke": "#e07d00",
            },
        })

    diff_fc = {
        "type": "FeatureCollection",
        "features": features,
    }

    return {
        "comparison_title": "Model vs Satellite Observation (Spatial Comparison)",
        "scenario_label": scenario_label,
        "timestep_label": timestep_label,
        "metrics": {
            "simulated_area_km2": area_sim,
            "observed_area_km2": area_obs,
            "agreement_area_km2": area_intersect,
            "simulated_only_area_km2": area_sim_only,
            "observed_only_area_km2": area_obs_only,
            "union_area_km2": round(area_union, 3),
            "iou": iou,
            "precision": precision,
            "recall": recall,
        },
        "difference_geojson": diff_fc,
        "temporal_advisory": {
            "simulation_scenario_date": "2008-08-18 (Historical Kusaha Breach)",
            "sar_observation_date": sar_metadata.get("acquired_utc") if sar_metadata else "Recent Live Acquisition",
            "note": (
                "TEMPORAL NOTICE: The Sentinel-1 SAR observation reflects current surface water conditions "
                "(revisit interval ~6–12 days), whereas the SWE simulation models the historical August 2008 "
                "embankment breach. Discrepancies primarily reflect the permanent Kosi main channel vs. the "
                "historical eastern breach avulsion corridor."
            ),
        },
        "provenance": {
            "satellite": "Copernicus Sentinel-1 (C-SAR)",
            "source_collection": "COPERNICUS/S1_GRD via Google Earth Engine",
            "polarization": "VV",
            "water_threshold_db": -17.0,
            "simulation_model": "2D SWE Lax-Friedrichs Finite-Volume Solver",
            "comparison_engine": "Shapely Geodesic Zonal Overlay (WGS84)",
        },
    }
