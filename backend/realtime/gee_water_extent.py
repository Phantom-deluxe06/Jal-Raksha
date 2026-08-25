"""
Real-time Sentinel-1 SAR water-extent layer over the Kosi AOI, via Google
Earth Engine. Every call queries GEE live for whatever the actual most
recent Sentinel-1 scene over the AOI is -- there is no cached or hardcoded
scene date; the "latest" scene naturally stays the same between calls only
because Sentinel-1's own revisit interval here is ~6-12 days, not because
this module is caching anything.

Water detection: VV-band backscatter thresholding. Smooth open-water
surfaces act as specular reflectors and return very little energy to the
radar, so they appear as a dark band in VV backscatter -- a standard,
widely-documented SAR water-detection technique (not ML, not calibrated
against ground truth for this specific AOI; see the caveat in the returned
payload).
"""
import datetime as dt
import json
from pathlib import Path

import ee

ROOT = Path(__file__).resolve().parent.parent.parent
CREDENTIALS_PATH = ROOT / "backend" / "credentials" / "service_account.json"
SERVICE_ACCOUNT = "floodsim-gee-servic@floodsim-hadr.iam.gserviceaccount.com"
GEE_PROJECT = "floodsim-hadr"
CONFIG_PATH = ROOT / "data" / "dam_config" / "kosi_case_study.json"

# Standard literature value for smooth-water VV backscatter in dB (e.g. UN-SPIDER's
# published Sentinel-1 flood-mapping recipe). Not tuned against ground truth for
# this specific AOI -- see the caveat surfaced in the response payload.
VV_WATER_THRESHOLD_DB = -17

# S1's revisit interval over this AOI is empirically ~6-12 days (mixed orbit
# coverage); 30 days gives slack to always find *a* recent scene without
# assuming a fixed cadence.
SEARCH_WINDOW_DAYS = 30

# Native GRD resolution is 10m; a 70km x 80km AOI at 10m is ~56M pixels, too
# slow for a synchronous request. 100m keeps reduceToVectors/getInfo within a
# few-to-tens-of-seconds live query while remaining well under GEE's default
# maxPixels budget (no bestEffort silent coarsening).
REDUCE_SCALE_M = 100
MAX_PIXELS = int(2e9)

_initialized = False


class GeeError(Exception):
    pass


def _ensure_initialized():
    global _initialized
    if _initialized:
        return
    if not CREDENTIALS_PATH.exists():
        raise GeeError(f"service account credentials not found at {CREDENTIALS_PATH}")
    creds = ee.ServiceAccountCredentials(SERVICE_ACCOUNT, str(CREDENTIALS_PATH))
    ee.Initialize(creds, project=GEE_PROJECT)
    _initialized = True


def _load_aoi_bounds() -> dict:
    config = json.loads(CONFIG_PATH.read_text())
    return config["aoi_bounds"]


def fetch_latest_water_extent() -> dict:
    """Live GEE query -- no caching. Raises GeeError on any real failure
    (network, quota, no scenes found, vectorization failure) rather than
    ever falling back to fake/placeholder data."""
    t0 = dt.datetime.now(dt.timezone.utc)
    _ensure_initialized()

    aoi_bounds = _load_aoi_bounds()
    aoi = ee.Geometry.Rectangle([
        aoi_bounds["west"], aoi_bounds["south"], aoi_bounds["east"], aoi_bounds["north"],
    ])

    now = dt.datetime.now(dt.timezone.utc)
    start = now - dt.timedelta(days=SEARCH_WINDOW_DAYS)

    collection = (
        ee.ImageCollection("COPERNICUS/S1_GRD")
        .filterBounds(aoi)
        .filterDate(ee.Date(start), ee.Date(now))
        .filter(ee.Filter.eq("instrumentMode", "IW"))
        .filter(ee.Filter.listContains("transmitterReceiverPolarisation", "VV"))
        .sort("system:time_start", False)
    )

    try:
        size = collection.size().getInfo()
    except Exception as e:
        raise GeeError(f"Earth Engine query failed: {e}") from e

    if size == 0:
        raise GeeError(
            f"no Sentinel-1 GRD scenes found over the Kosi AOI in the last "
            f"{SEARCH_WINDOW_DAYS} days -- this is a real gap in satellite "
            f"coverage, not a query error"
        )

    latest = collection.first()
    try:
        info = latest.getInfo()
    except Exception as e:
        raise GeeError(f"failed to fetch scene metadata: {e}") from e

    scene_id = info["id"]
    acquired_ms = info["properties"]["system:time_start"]
    acquired_utc = dt.datetime.fromtimestamp(acquired_ms / 1000, tz=dt.timezone.utc).isoformat()
    orbit_pass = info["properties"].get("orbitProperties_pass")
    relative_orbit = info["properties"].get("relativeOrbitNumber_start")

    vv = latest.select("VV").clip(aoi)
    water_mask = vv.lt(VV_WATER_THRESHOLD_DB).selfMask()

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
        raise GeeError(f"water-extent vectorization failed: {e}") from e

    area_km2 = None
    try:
        area_result = water_mask.multiply(ee.Image.pixelArea()).reduceRegion(
            reducer=ee.Reducer.sum(), geometry=aoi, scale=REDUCE_SCALE_M, maxPixels=MAX_PIXELS,
        ).get("VV")
        area_m2 = ee.Number(area_result).getInfo()
        area_km2 = round(area_m2 / 1e6, 2) if area_m2 is not None else None
    except Exception:
        area_km2 = None  # non-fatal -- the polygon geometry itself is the primary result

    t1 = dt.datetime.now(dt.timezone.utc)

    return {
        "type": "FeatureCollection",
        "features": fc.get("features", []),
        "water_area_km2": area_km2,
        "source": {
            "name": "Copernicus Sentinel-1 SAR (GRD), via Google Earth Engine",
            "collection": "COPERNICUS/S1_GRD",
            "scene_id": scene_id,
            "acquired_utc": acquired_utc,
            "orbit_pass": orbit_pass,
            "relative_orbit_number": relative_orbit,
            "polarization": "VV",
            "scenes_available_last_30d": size,
        },
        "detection_method": {
            "technique": "VV backscatter thresholding",
            "threshold_db": VV_WATER_THRESHOLD_DB,
            "explanation": (
                "Smooth open-water surfaces are specular reflectors and return little "
                "energy to a side-looking radar, so they appear dark (low backscatter) "
                "in the VV band. Pixels below the threshold are flagged as water."
            ),
            "reduce_scale_m": REDUCE_SCALE_M,
            "caveat": (
                "This is a standard literature threshold, not calibrated against ground "
                "truth for this specific AOI -- wind-roughened water, wet bare soil, and "
                "radar shadow can all cause false positives/negatives. Treat as an "
                "indicative real-time observation layer, not a validated flood product."
            ),
        },
        "query_duration_s": round((t1 - t0).total_seconds(), 2),
        "queried_at_utc": t1.isoformat(),
    }
