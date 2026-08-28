"""
Demo-day preflight: hits every endpoint the demo touches and checks every
data asset, printing one PASS/FAIL line each. Exit code 0 iff all critical
checks pass.

Usage:  python scripts/demo_day_check.py            (expects backend on :8000)
        python scripts/demo_day_check.py --in-process (spins the app up itself)
"""
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"

DATA_ASSETS = [
    "data/dem/kosi_aoi_srtm30m.tif",
    "data/population/kosi_aoi_worldpop_2020.tif",
    "data/satellite/kosi_aoi_sentinel2_tci_20231228_40m.tif",
    "data/settlements/kosi_aoi_settlements.geojson",
    "data/dam_config/kosi_case_study.json",
    "data/dem/hirakud_mahanadi_srtm30m.tif",
    "data/dem/godavari_dowleswaram_srtm30m.tif",
    "backend/ml_checkpoints/flood_unet_best.pt",
    "backend/outputs/swe_kosi_actual2008/metadata.json",
    "backend/outputs/sph_kosi_breach/metadata.json",
    "backend/credentials/service_account.json",
]

# (method, path, predicate on parsed json/None, critical?)
ENDPOINTS = [
    ("GET", "/health", lambda j: j.get("status") == "ok", True),
    ("GET", "/terrain/dem?downsample=8", lambda j: j.get("rows", 0) > 0, True),
    ("GET", "/terrain/satellite", None, True),
    ("GET", "/infrastructure/settlements", lambda j: len(j.get("features", [])) >= 300, True),
    ("GET", "/infrastructure/roads", lambda j: j.get("type") == "FeatureCollection", False),
    ("GET", "/twin/state", lambda j: "last_good_sync" in j, True),
    ("GET", "/sph/result", lambda j: "hardware" in j, True),
    ("GET", "/scenarios/library", lambda j: len(j.get("entries", [])) >= 2, True),
    ("POST", "/predict/instant", lambda j: j.get("max_depth_m") is not None, True),
    ("GET", "/realtime/water-extent", lambda j: j.get("type") == "FeatureCollection", False),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--in-process", action="store_true")
    args = ap.parse_args()

    ok = True
    print("== data assets ==")
    for rel in DATA_ASSETS:
        exists = (ROOT / rel).exists()
        ok &= exists
        print(f"  [{'PASS' if exists else 'FAIL'}] {rel}")

    print("== endpoints ==")
    if args.in_process:
        sys.path.insert(0, str(BACKEND))
        from fastapi.testclient import TestClient
        import main as app_main
        client = TestClient(app_main.app)

        def hit(method, path):
            r = client.post(path, json={}) if method == "POST" else client.get(path)
            return r.status_code, (r.json() if "json" in r.headers.get("content-type", "") else None)
    else:
        import requests

        def hit(method, path):
            r = (requests.post if method == "POST" else requests.get)(
                args.base + path, json={} if method == "POST" else None, timeout=60
            )
            ctype = r.headers.get("content-type", "")
            return r.status_code, (r.json() if "json" in ctype else None)

    for method, path, pred, critical in ENDPOINTS:
        try:
            code, body = hit(method, path)
            good = code == 200 and (pred is None or pred(body))
        except Exception as e:
            code, good = f"ERR {e}", False
        tag = "PASS" if good else ("WARN" if not critical else "FAIL")
        if critical and not good:
            ok = False
        print(f"  [{tag}] {method} {path}  ({code})")

    print("\n" + ("ALL CRITICAL CHECKS PASSED" if ok else "SOME CRITICAL CHECKS FAILED"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
