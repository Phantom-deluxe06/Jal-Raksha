"""
Run the SWE solver on the real Kosi AOI DEM using the ACTUAL 2008 Kusaha
breach discharge (not the barrage's theoretical design discharge), and write
out a time series of depth grids + web-friendly overlays + GIS exports +
a metadata/sanity-check report.

Usage: python backend/swe/run_kosi_swe.py
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from swe.scenario_runner import execute_scenario, get_default_kosi_scenario

DEM_PATH = ROOT / "data" / "dem" / "kosi_aoi_srtm30m.tif"
TARGET_RES_DEG = 0.0016667


def main():
    scenario = get_default_kosi_scenario()
    print(f"Running reference historical scenario: {scenario['metadata']['name']}")
    execute_scenario(scenario)


if __name__ == "__main__":
    main()
