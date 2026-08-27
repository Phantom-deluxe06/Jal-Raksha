"""
Real-time Sentinel-1 SAR water-extent layer and Model-vs-Observation validation over the Kosi AOI,
via Google Earth Engine.

Features:
  1. Multi-mode authentication (Service Account JSON or standard EE User token) with clear setup guides.
  2. Live Sentinel-1 GRD retrieval based on study area, date/time, and orbit pass.
  3. Specular reflection VV-band SAR backscatter thresholding (standard UN-SPIDER flood mapping method).
  4. Spatial alignment & comparative validation against 2D SWE simulation (Intersection, Sim-only, Obs-only, IoU, Precision, Recall, F1).
  5. Honest failure handling with temporal discrepancy alerts.
"""
import datetime as dt
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import ee
import geopandas as gpd
import numpy as np
from shapely.geometry import MultiPolygon, Polygon, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent.parent
CREDENTIALS_DIR = ROOT / "backend" / "credentials"
CREDENTIALS_PATH = CREDENTIALS_DIR / "service_account.json"
SERVICE_ACCOUNT_DEFAULT = "floodsim-gee-servic@floodsim-hadr.iam.gserviceaccount.com"
GEE_PROJECT_DEFAULT = os.environ.get("EE_PROJECT_ID", "floodsim-hadr")
CONFIG_PATH = ROOT / "data" / "dam_config" / "kosi_case_study.json"
OUTPUTS_DIR = ROOT / "backend" / "outputs"

# Standard literature value for smooth-water VV backscatter in dB (e.g. UN-SPIDER recommended threshold).
VV_WATER_THRESHOLD_DB = -17.0

# S1 revisit interval over Kosi AOI is ~6-12 days; 30 days window default
SEARCH_WINDOW_DAYS = 30

# Vectorization scale (100m keeps reduceToVectors within live interactive latency)
REDUCE_SCALE_M = 100
MAX_PIXELS = int(2e9)

_initialized = False
_auth_mode = "none"


class GeeError(Exception):
    """Base Earth Engine operational error."""
    pass


class GeeAuthError(GeeError):
    """Earth Engine authentication missing or invalid error with setup instructions."""
    pass


def get_auth_setup_instructions() -> str:
    """Returns developer setup instructions for Earth Engine authentication."""
    return (
        "Google Earth Engine Authentication Setup:\n"
        "1. Service Account (Recommended for Server):\n"
        "   - Create a Service Account in your Google Cloud Project with Earth Engine API enabled.\n"
        "   - Download the JSON private key and save it as: backend/credentials/service_account.json\n"
        "   - Set environment variable GEE_PROJECT=<your-gcp-project-id> if different from 'floodsim-hadr'.\n"
        "2. User Token (Interactive CLI):\n"
        "   - Run: earthengine authenticate\n"
        "   - Complete the browser authorization flow."
    )


def check_auth_status() -> Dict[str, Any]:
    """Checks whether Earth Engine credentials are present and valid."""
    global _initialized, _auth_mode

    # Check Service Account Key File
    sa_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", str(CREDENTIALS_PATH))
    has_sa_file = Path(sa_path).exists()

    if _initialized:
        return {
            "authenticated": True,
            "mode": _auth_mode,
            "project": GEE_PROJECT_DEFAULT,
            "has_credentials_file": has_sa_file,
            "credentials_path": str(sa_path) if has_sa_file else None,
            "instructions": None,
        }

    # Try initializing
    try:
        if has_sa_file:
            sa_data = json.loads(Path(sa_path).read_text(encoding="utf-8"))
            sa_email = sa_data.get("client_email", SERVICE_ACCOUNT_DEFAULT)
            creds = ee.ServiceAccountCredentials(sa_email, str(sa_path))
            ee.Initialize(creds, project=GEE_PROJECT_DEFAULT)
            _initialized = True
            _auth_mode = "service_account"
            return {
                "authenticated": True,
                "mode": "service_account",
                "service_account": sa_email,
                "project": GEE_PROJECT_DEFAULT,
                "has_credentials_file": True,
                "credentials_path": str(sa_path),
                "instructions": None,
            }
        else:
            # Try default user credentials
            ee.Initialize(project=GEE_PROJECT_DEFAULT)
            _initialized = True
            _auth_mode = "user_credentials"
            return {
                "authenticated": True,
                "mode": "user_credentials",
                "project": GEE_PROJECT_DEFAULT,
                "has_credentials_file": False,
                "instructions": None,
            }
    except Exception as e:
        return {
            "authenticated": False,
            "mode": "none",
            "project": GEE_PROJECT_DEFAULT,
            "has_credentials_file": has_sa_file,
            "error": str(e),
            "instructions": get_auth_setup_instructions(),
        }


def _ensure_initialized():
    """Initializes Earth Engine or raises structured GeeAuthError."""
    global _initialized, _auth_mode
    if _initialized:
        return

    status = check_auth_status()
    if not status["authenticated"]:
        raise GeeAuthError(
            f"Google Earth Engine is not authenticated: {status.get('error', 'Credentials not found')}.\n\n"
            f"{get_auth_setup_instructions()}"
        )


def _load_aoi_bounds() -> Dict[str, float]:
    """Loads default AOI bounding box from case study configuration."""
    if CONFIG_PATH.exists():
        config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        if "aoi_bounds" in config:
            return config["aoi_bounds"]
    return {"west": 86.6, "south": 25.9, "east": 87.3, "north": 26.7}


def fetch_latest_water_extent(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    orbit_pass: Optional[str] = None,
    threshold_db: float = VV_WATER_THRESHOLD_DB,
    aoi_bounds: Optional[Dict[str, float]] = None,
) -> Dict[str, Any]:
    """
    Live GEE query for Sentinel-1 SAR water extent.
    
    Parameters:
      - start_date, end_date: ISO date strings ('YYYY-MM-DD'). Defaults to last 30 days.
      - orbit_pass: 'ASCENDING', 'DESCENDING', or None for both.
      - threshold_db: Backscatter threshold in dB for smooth water detection (default: -17.0 dB).
      - aoi_bounds: dict with west, south, east, north.
    """
    t0 = dt.datetime.now(dt.timezone.utc)
    _ensure_initialized()

    bounds = aoi_bounds or _load_aoi_bounds()
    aoi = ee.Geometry.Rectangle([
        bounds["west"], bounds["south"], bounds["east"], bounds["north"],
    ])

    now = dt.datetime.now(dt.timezone.utc)
    if end_date:
        ee_end = ee.Date(end_date)
    else:
        ee_end = ee.Date(now)

    if start_date:
        ee_start = ee.Date(start_date)
    else:
        ee_start = ee_end.advance(-SEARCH_WINDOW_DAYS, "day")

    collection = (
        ee.ImageCollection("COPERNICUS/S1_GRD")
        .filterBounds(aoi)
        .filterDate(ee_start, ee_end)
        .filter(ee.Filter.eq("instrumentMode", "IW"))
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
    )

    if orbit_pass and orbit_pass.upper() in ("ASCENDING", "DESCENDING"):
        collection = collection.filter(ee.Filter.eq("orbitProperties_pass", orbit_pass.upper()))

    collection = collection.sort("system:time_start", False)

    try:
        size = collection.size().getInfo()
    except Exception as e:
        raise GeeError(f"Earth Engine query failed: {e}") from e

    if size == 0:
        date_str = f"between {start_date} and {end_date}" if start_date and end_date else f"in the last {SEARCH_WINDOW_DAYS} days"
        raise GeeError(
            f"No suitable Sentinel-1 observation available for the selected criteria ({date_str}). "
            f"This represents a gap in satellite coverage over the AOI."
        )

    latest = collection.first()
    try:
        info = latest.getInfo()
    except Exception as e:
        raise GeeError(f"Failed to fetch Sentinel-1 scene metadata: {e}") from e

    scene_id = info.get("id", "Unknown Scene")
    props = info.get("properties", {})
    acquired_ms = props.get("system:time_start", 0)
    acquired_utc = dt.datetime.fromtimestamp(acquired_ms / 1000, tz=dt.timezone.utc).isoformat()
    scene_orbit_pass = props.get("orbitProperties_pass", "Unknown")
    relative_orbit = props.get("relativeOrbitNumber_start")
    platform = props.get("platform_number", "A")

    # Select VV polarization and clip to study area
    vv = latest.select("VV").clip(aoi)

    # 3x3 Focal Median Filter for radar speckle reduction
    vv_filtered = vv.focal_median(radius=50, units="meters", iterations=1)

    # Specular water mask: smooth water backscatter < threshold_db
    water_mask = vv_filtered.lt(threshold_db).selfMask()

    try:
        vectors = water_mask.reduceToVectors(
            geometry=aoi,
            scale=REDUCE_SCALE_M,
            geometryType="polygon",
            eightConnected=True,
            maxPixels=MAX_PIXELS,
        )
        fc = vectors.getInfo()
    except Exception as e:
        raise GeeError(f"Water-extent vectorization failed: {e}") from e

    area_km2 = None
    try:
        area_result = water_mask.multiply(ee.Image.pixelArea()).reduceRegion(
            reducer=ee.Reducer.sum(), geometry=aoi, scale=REDUCE_SCALE_M, maxPixels=MAX_PIXELS,
        ).get("VV")
        area_m2 = ee.Number(area_result).getInfo()
        area_km2 = round(area_m2 / 1e6, 2) if area_m2 is not None else None
    except Exception:
        area_km2 = None

    t1 = dt.datetime.now(dt.timezone.utc)

    return {
        "type": "FeatureCollection",
        "features": fc.get("features", []),
        "water_area_km2": area_km2,
        "source": {
            "satellite": f"Copernicus Sentinel-1{platform}",
            "instrument": "C-SAR (C-band Synthetic Aperture Radar, 5.405 GHz)",
            "collection": "COPERNICUS/S1_GRD",
            "product_type": "GRD (Ground Range Detected, IW Mode)",
            "scene_id": scene_id,
            "acquired_utc": acquired_utc,
            "orbit_pass": scene_orbit_pass,
            "relative_orbit_number": relative_orbit,
            "polarization": "VV",
            "scenes_available_in_window": size,
            "bounds": bounds,
        },
        "detection_method": {
            "technique": "VV backscatter thresholding with 50m focal median despeckling",
            "threshold_db": threshold_db,
            "reduce_scale_m": REDUCE_SCALE_M,
            "explanation": (
                "Smooth open-water surfaces act as specular reflectors, scattering radar pulses away from the antenna, "
                "appearing dark (low backscatter) in the VV band. Pixels below the threshold are classified as water."
            ),
            "caveat": (
                "SAR water detection is an indicative satellite observation product. Radar shadow, smooth dry sands, "
                "and asphalt can occasionally cause false positives, while wind-induced surface waves or emergent "
                "vegetation can cause false negatives. This is an observation layer, not an infallible ground truth."
            ),
        },
        "query_duration_s": round((t1 - t0).total_seconds(), 2),
        "queried_at_utc": t1.isoformat(),
    }


def compare_swe_vs_sar(
    sar_fc: Dict[str, Any],
    job_id: str = "kosi_actual2008",
    frame_index: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Computes spatial intersection and validation metrics between SWE simulation and Sentinel-1 SAR observation.
    
    Generates:
      - Intersection Area (Agreement / True Positive) in km²
      - Simulation Only Area (Overestimation) in km²
      - Observation Only Area (Underestimation / Baseline Water) in km²
      - Total Footprint Area (Union) in km²
      - IoU (Intersection over Union / Jaccard Index)
      - Precision, Recall, and F1 / Dice Score
      - Comparison GeoJSON layer with 3 classes
      - Explicit Temporal Comparability Assessment
    """
    # 1. Resolve Simulation Output Directory & Extent GeoJSON
    out_dir = OUTPUTS_DIR / ("swe_kosi_actual2008" if job_id in ("kosi_actual2008", "kosi_2008_historical") else f"swe_{job_id}")
    meta_path = out_dir / "metadata.json"

    if not meta_path.exists():
        raise FileNotFoundError(f"Simulation metadata not found for '{job_id}'. Run simulation first.")

    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    frames = meta.get("frames", [])

    if frame_index is not None and 0 <= frame_index < len(frames):
        sim_geojson_rel = frames[frame_index]["geojson"]
        sim_time_desc = f"T+{frames[frame_index]['t_minutes']} min snapshot"
    else:
        sim_geojson_rel = "export/flood_extent_max.geojson"
        sim_time_desc = "Maximum scenario footprint"

    sim_geojson_path = out_dir / sim_geojson_rel
    if not sim_geojson_path.exists():
        raise FileNotFoundError(f"Simulation flood extent GeoJSON not found at {sim_geojson_path}")

    # 2. Parse Geometries via Shapely & GeoPandas
    sim_data = json.loads(sim_geojson_path.read_text(encoding="utf-8"))
    sim_geoms = []
    for f in sim_data.get("features", []):
        try:
            g = shape(f["geometry"])
            if g.is_valid and not g.is_empty:
                sim_geoms.append(g)
        except Exception:
            pass

    sar_geoms = []
    for f in sar_fc.get("features", []):
        try:
            g = shape(f["geometry"])
            if g.is_valid and not g.is_empty:
                sar_geoms.append(g)
        except Exception:
            pass

    if not sim_geoms:
        sim_poly = Polygon()
    else:
        sim_poly = unary_union(sim_geoms)

    if not sar_geoms:
        sar_poly = Polygon()
    else:
        sar_poly = unary_union(sar_geoms)

    # 3. Spatial Set Operations (in WGS84, converted to km² using UTM or approx projection)
    # Area conversion: average latitude ~26.3°N -> 1 deg lat ~ 111.32 km, 1 deg lon ~ 99.8 km
    center_lat = 26.3
    deg2_to_km2 = (111.32 * np.cos(np.radians(center_lat))) * 111.32

    sim_area_km2 = sim_poly.area * deg2_to_km2
    sar_area_km2 = sar_poly.area * deg2_to_km2

    intersection_poly = sim_poly.intersection(sar_poly)
    sim_only_poly = sim_poly.difference(sar_poly)
    sar_only_poly = sar_poly.difference(sim_poly)
    union_poly = sim_poly.union(sar_poly)

    intersection_km2 = round(intersection_poly.area * deg2_to_km2, 2)
    sim_only_km2 = round(sim_only_poly.area * deg2_to_km2, 2)
    sar_only_km2 = round(sar_only_poly.area * deg2_to_km2, 2)
    union_km2 = round(union_poly.area * deg2_to_km2, 2)

    # 4. Statistical Validation Metrics
    iou = round(intersection_km2 / union_km2, 4) if union_km2 > 0 else 0.0
    precision = round(intersection_km2 / sim_area_km2, 4) if sim_area_km2 > 0 else 0.0
    recall = round(intersection_km2 / sar_area_km2, 4) if sar_area_km2 > 0 else 0.0
    f1_score = round(2 * (precision * recall) / (precision + recall), 4) if (precision + recall) > 0 else 0.0

    # 5. Build Difference GeoJSON Feature Collection
    diff_features = []
    if not intersection_poly.is_empty:
        diff_features.append({
            "type": "Feature",
            "geometry": json.loads(gpd.GeoSeries([intersection_poly]).to_json())["features"][0]["geometry"],
            "properties": {
                "class": "agreement",
                "label": "Model & Observation Agreement (True Positive)",
                "area_km2": intersection_km2,
                "color": "#2ecc71",
            },
        })
    if not sim_only_poly.is_empty:
        diff_features.append({
            "type": "Feature",
            "geometry": json.loads(gpd.GeoSeries([sim_only_poly]).to_json())["features"][0]["geometry"],
            "properties": {
                "class": "simulated_only",
                "label": "Simulated Inundation Only (Overestimation / Unobserved)",
                "area_km2": sim_only_km2,
                "color": "#3498db",
            },
        })
    if not sar_only_poly.is_empty:
        diff_features.append({
            "type": "Feature",
            "geometry": json.loads(gpd.GeoSeries([sar_only_poly]).to_json())["features"][0]["geometry"],
            "properties": {
                "class": "observed_only",
                "label": "SAR Observed Water Only (Baseline Channel / Wetland)",
                "area_km2": sar_only_km2,
                "color": "#e67e22",
            },
        })

    diff_fc = {
        "type": "FeatureCollection",
        "features": diff_features,
    }

    # 6. Temporal Comparability Check & Honest Warning
    sar_acquired_iso = sar_fc.get("source", {}).get("acquired_utc", "")
    sim_scenario_label = meta.get("scenario_label", job_id)
    sim_event_date = meta.get("metadata", {}).get("created_at", "2008-08-18")

    temporal_warning = None
    is_temporally_comparable = False

    try:
        sar_dt = dt.datetime.fromisoformat(sar_acquired_iso.replace("Z", "+00:00"))
        # If simulation represents 2008 historical case
        if "2008" in sim_event_date or "2008" in sim_scenario_label:
            sim_dt = dt.datetime(2008, 8, 18, tzinfo=dt.timezone.utc)
            delta_days = abs((sar_dt - sim_dt).days)
            if delta_days > 30:
                temporal_warning = (
                    f"TEMPORAL MISMATCH NOTICE: The active simulation models the historical 18 August 2008 Kosi breach, "
                    f"whereas this Sentinel-1 SAR acquisition was captured on {sar_dt.strftime('%d %b %Y')}. "
                    f"Sentinel-1 was launched in 2014; contemporary SAR imagery captures current river geomorphology and "
                    f"wetland extents rather than historical floodwaters. Treat this as a structural spatial cross-check, "
                    f"not a contemporaneous event validation."
                )
            else:
                is_temporally_comparable = True
        else:
            is_temporally_comparable = True
    except Exception:
        temporal_warning = "Could not verify temporal alignment between satellite pass and simulation timestamp."

    return {
        "scenario_id": job_id,
        "scenario_label": sim_scenario_label,
        "simulation_scope": sim_time_desc,
        "sar_source": sar_fc.get("source", {}),
        "detection_method": sar_fc.get("detection_method", {}),
        "areas_km2": {
            "simulated_flood_area": round(sim_area_km2, 2),
            "observed_water_area": round(sar_area_km2, 2),
            "agreement_area": intersection_km2,
            "simulated_only_area": sim_only_km2,
            "observed_only_area": sar_only_km2,
            "total_union_area": union_km2,
        },
        "metrics": {
            "iou_jaccard_index": iou,
            "precision": precision,
            "recall": recall,
            "f1_dice_score": f1_score,
            "metric_definitions": {
                "iou": "Intersection area / Union area (A_sim ∩ A_obs / A_sim ∪ A_obs)",
                "precision": "Agreement area / Simulated area (A_sim ∩ A_obs / A_sim)",
                "recall": "Agreement area / Observed area (A_sim ∩ A_obs / A_obs)",
                "f1_score": "Harmonic mean of precision and recall (2 * P * R / (P + R))",
            },
        },
        "temporal_alignment": {
            "simulation_date": sim_event_date,
            "sar_acquired_utc": sar_acquired_iso,
            "is_temporally_comparable": is_temporally_comparable,
            "warning": temporal_warning,
        },
        "provenance": {
            "satellite": sar_fc.get("source", {}).get("satellite", "Sentinel-1"),
            "scene_id": sar_fc.get("source", {}).get("scene_id"),
            "acquisition_date": sar_acquired_iso,
            "processing_technique": sar_fc.get("detection_method", {}).get("technique"),
            "simulation_scenario": sim_scenario_label,
        },
        "difference_geojson": diff_fc,
    }
