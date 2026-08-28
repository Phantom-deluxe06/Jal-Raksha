"""
Pre-cache the Kosi AOI road network as GeoJSON so /infrastructure/roads serves
instantly and works offline on demo day.

Tries the Overpass API first (fast when reachable), then falls back to a
Geofabrik OSM extract parsed with pyosmium (works with no Overpass access).
Writes backend/outputs/kosi_aoi_roads.geojson.

Usage:  python scripts/fetch_roads.py
"""
import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

import main  # noqa: E402  (FastAPI app module exposes the fetch helpers)


def run() -> Path:
    bounds = main._KOSI_AOI_BOUNDS
    out_path = main._ROADS_CACHE_PATH
    out_path.parent.mkdir(parents=True, exist_ok=True)

    fc = None
    for name, fn in (
        ("Overpass API", lambda: main._fetch_overpass_roads(bounds)),
        ("Geofabrik extract (pyosmium)", lambda: main._roads_from_geofabrik(bounds)),
    ):
        try:
            print(f"[fetch_roads] trying {name} ...")
            fc = fn()
            print(f"[fetch_roads]   {name} -> {len(fc['features'])} road features")
            break
        except Exception as e:
            print(f"[fetch_roads]   {name} failed: {e}")

    if fc is None:
        raise SystemExit("[fetch_roads] all sources failed — no roads cached")

    out_path.write_text(json.dumps(fc), encoding="utf-8")
    print(f"[fetch_roads] cached -> {out_path}  ({len(fc['features'])} features)")
    return out_path


if __name__ == "__main__":
    run()
