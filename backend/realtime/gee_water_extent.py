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
widely-documented SAR water-detection technique.
"""
import os
import datetime as dt
import json
from pathlib import Path

import ee

ROOT = Path(__file__).resolve().parent.parent.parent
CREDENTIALS_PATH = ROOT / "backend" / "credentials" / "service_account.json"
CONFIG_PATH = ROOT / "data" / "dam_config" / "kosi_case_study.json"
GEE_PROJECT = os.environ.get("GEE_PROJECT", "floodsim-hadr")
SERVICE_ACCOUNT = os.environ.get(
    "GEE_SERVICE_ACCOUNT",
    "floodsim-gee-servic@floodsim-hadr.iam.gserviceaccount.com"
)

# Standard literature value for smooth-water VV backscatter in dB (e.g. UN-SPIDER's
# published Sentinel-1 flood-mapping recipe). Not tuned against ground truth for
# this specific AOI -- see the caveat surfaced in the response payload.
VV_WATER_THRESHOLD_DB = -17.0

# S1's revisit interval over this AOI is empirically ~6-12 days (mixed orbit
# coverage); 30 days gives slack to always find *a* recent scene without
# assuming a fixed cadence.
SEARCH_WINDOW_DAYS = 30

# Native GRD resolution is 10m; a 70km x 80km AOI at 10m is ~56M pixels, too
# slow for a synchronous request. 100m keeps reduceToVectors/getInfo within a
# few-to-tens-of-seconds live query while remaining well under GEE's default
# maxPixels budget.
REDUCE_SCALE_M = 100
MAX_PIXELS = int(2e9)

_initialized = False


class GeeError(Exception):
    pass


class GeeAuthError(GeeError):
    def __init__(self, message: str, instructions: list[str] = None):
        super().__init__(message)
        self.instructions = instructions or [
            "1. Place your GCP Service Account JSON key at backend/credentials/service_account.json",
            "2. Or set the GOOGLE_APPLICATION_CREDENTIALS environment variable to your key path",
            "3. Or run 'gcloud auth application-default login' on your development machine",
        ]


def _ensure_initialized():
    global _initialized
    if _initialized:
        return

    # Strategy 1: Explicit Service Account JSON file in backend/credentials/
    if CREDENTIALS_PATH.exists():
        try:
            creds = ee.ServiceAccountCredentials(SERVICE_ACCOUNT, str(CREDENTIALS_PATH))
            ee.Initialize(creds, project=GEE_PROJECT)
            _initialized = True
            return
        except Exception as e:
            raise GeeAuthError(f"Service account authentication failed with {CREDENTIALS_PATH}: {e}")

    # Strategy 2: Environment variable GOOGLE_APPLICATION_CREDENTIALS
    env_creds = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if env_creds and Path(env_creds).exists():
        try:
            creds = ee.ServiceAccountCredentials(SERVICE_ACCOUNT, env_creds)
            ee.Initialize(creds, project=GEE_PROJECT)
            _initialized = True
            return
        except Exception as e:
            raise GeeAuthError(f"Authentication failed with GOOGLE_APPLICATION_CREDENTIALS ({env_creds}): {e}")

    # Strategy 3: Default credentials / User token (ADC or ee.Authenticate token)
    try:
        ee.Initialize(project=GEE_PROJECT)
        _initialized = True
        return
    except Exception as e:
        raise GeeAuthError(
            "Google Earth Engine authentication credentials not found. "
            "To query live Sentinel-1 SAR data, configure valid credentials.",
            instructions=[
                "Option A: Place a Service Account key at 'backend/credentials/service_account.json'",
                "Option B: Run 'gcloud auth application-default login' in terminal",
                "Option C: Run 'python -c \"import ee; ee.Authenticate()\"' to link your Google account",
            ],
        )


def _load_aoi_bounds() -> dict:
    if not CONFIG_PATH.exists():
        return dict(west=86.6, south=25.9, east=87.3, north=26.7)
    config = json.loads(CONFIG_PATH.read_text())
    return config.get("aoi_bounds", dict(west=86.6, south=25.9, east=87.3, north=26.7))


def fetch_latest_water_extent(threshold_db: float = VV_WATER_THRESHOLD_DB, search_days: int = SEARCH_WINDOW_DAYS) -> dict:
    """Live GEE query -- queries COPERNICUS/S1_GRD for the most recent scene.
    Raises GeeAuthError on missing credentials, or GeeError on query failure."""
    t0 = dt.datetime.now(dt.timezone.utc)
    _ensure_initialized()

    aoi_bounds = _load_aoi_bounds()
    aoi = ee.Geometry.Rectangle([
        aoi_bounds["west"], aoi_bounds["south"], aoi_bounds["east"], aoi_bounds["north"],
    ])

    now = dt.datetime.now(dt.timezone.utc)
    start = now - dt.timedelta(days=search_days)

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
            f"No suitable Sentinel-1 GRD scenes found over the Kosi AOI in the last "
            f"{search_days} days. This represents satellite orbit pass timing, not a query error."
        )

    latest = collection.first()
    try:
        info = latest.getInfo()
    except Exception as e:
        raise GeeError(f"Failed to fetch Sentinel-1 scene metadata: {e}") from e

    scene_id = info["id"]
    acquired_ms = info["properties"]["system:time_start"]
    acquired_utc = dt.datetime.fromtimestamp(acquired_ms / 1000, tz=dt.timezone.utc).isoformat()
    orbit_pass = info["properties"].get("orbitProperties_pass", "UNKNOWN")
    relative_orbit = info["properties"].get("relativeOrbitNumber_start", "UNKNOWN")

    vv = latest.select("VV").clip(aoi)
    water_mask = vv.lt(threshold_db).selfMask()

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
            "satellite": "Copernicus Sentinel-1 (C-SAR)",
            "sensor": "C-band Synthetic Aperture Radar (C-SAR)",
            "collection": "COPERNICUS/S1_GRD",
            "scene_id": scene_id,
            "acquired_utc": acquired_utc,
            "orbit_pass": orbit_pass,
            "relative_orbit_number": relative_orbit,
            "polarization": "VV",
            "instrument_mode": "IW (Interferometric Wide Swath)",
            "scenes_available_last_30d": size,
        },
        "detection_method": {
            "technique": "VV backscatter thresholding (specular reflection)",
            "threshold_db": threshold_db,
            "explanation": (
                "Smooth open-water surfaces act as specular reflectors and scatter radar energy "
                "away from the antenna, appearing dark (low backscatter, < -17 dB) in the VV band. "
                "Detected water pixels are vectorized at 100m scale."
            ),
            "reduce_scale_m": REDUCE_SCALE_M,
            "caveat": (
                "Thresholding is an indicative observation method: wind-roughened open water, "
                "radar shadows in rough terrain, and wet bare soil can create false positives or negatives. "
                "This layer represents satellite-observed surface water at pass time, not an authoritative flood claim."
            ),
        },
        "query_duration_s": round((t1 - t0).total_seconds(), 2),
        "queried_at_utc": t1.isoformat(),
    }
