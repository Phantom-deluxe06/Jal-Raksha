"""
SWE Simulation Query Engine for FloodSim-HADR.

Provides spatial point querying, coordinate-to-grid conversions,
arrival-time calculation, and time-series extraction from the SWE solver outputs.
Caches simulation raster stacks in memory for sub-millisecond query performance.
"""
from pathlib import Path
import json
import threading
import numpy as np
import rasterio
from rasterio.transform import Affine

ROOT = Path(__file__).resolve().parent.parent.parent
OUTPUTS_DIR = Path(__file__).resolve().parent.parent / "outputs"


class SimulationQueryEngine:
    _instances = {}
    _lock = threading.Lock()

    def __init__(self, job_out_dir: Path):
        self.job_out_dir = job_out_dir
        self.metadata_path = job_out_dir / "metadata.json"
        self.meta = {}
        self.rows = 0
        self.cols = 0
        self.transform = None
        self.bounds = {}
        self.times_minutes = []
        self.times_seconds = []
        self.depth_stack = None  # (N, rows, cols) float32
        self.u_stack = None      # (N, rows, cols) float32
        self.v_stack = None      # (N, rows, cols) float32
        self.elevation_grid = None  # (rows, cols) float32
        self._load_data()

    @classmethod
    def get_engine(cls, job_id: str = "kosi_actual2008"):
        out_dir = OUTPUTS_DIR / f"swe_{job_id}"
        with cls._lock:
            if job_id not in cls._instances:
                cls._instances[job_id] = cls(out_dir)
            return cls._instances[job_id]

    @classmethod
    def invalidate_cache(cls, job_id: str = "kosi_actual2008"):
        with cls._lock:
            if job_id in cls._instances:
                del cls._instances[job_id]

    def _load_data(self):
        if not self.metadata_path.exists():
            raise FileNotFoundError(f"Metadata not found at {self.metadata_path}")

        self.meta = json.loads(self.metadata_path.read_text())
        frames = self.meta.get("frames", [])
        if not frames:
            raise ValueError("No frames found in simulation metadata")

        grid_meta = self.meta["grid"]
        self.rows = grid_meta["rows"]
        self.cols = grid_meta["cols"]
        self.bounds = self.meta["bounds"]

        # Build affine transform from bounds and dimensions
        self.transform = rasterio.transform.from_bounds(
            self.bounds["west"],
            self.bounds["south"],
            self.bounds["east"],
            self.bounds["north"],
            self.cols,
            self.rows,
        )

        n_frames = len(frames)
        self.times_minutes = [f["t_minutes"] for f in frames]
        self.times_seconds = [f["t_seconds"] for f in frames]

        self.depth_stack = np.zeros((n_frames, self.rows, self.cols), dtype=np.float32)
        self.u_stack = np.zeros((n_frames, self.rows, self.cols), dtype=np.float32)
        self.v_stack = np.zeros((n_frames, self.rows, self.cols), dtype=np.float32)

        for i, frame in enumerate(frames):
            depth_path = self.job_out_dir / frame["depth_tif"]
            u_path = self.job_out_dir / frame["u_tif"]
            v_path = self.job_out_dir / frame["v_tif"]

            if depth_path.exists():
                with rasterio.open(depth_path) as src:
                    self.depth_stack[i] = src.read(1)
            if u_path.exists():
                with rasterio.open(u_path) as src:
                    self.u_stack[i] = src.read(1)
            if v_path.exists():
                with rasterio.open(v_path) as src:
                    self.v_stack[i] = src.read(1)

        # Load DEM elevation grid for accurate elevation querying
        try:
            from swe.dem_utils import load_dem_grid
            from swe import run_kosi_swe
            grid = load_dem_grid(str(run_kosi_swe.DEM_PATH), run_kosi_swe.TARGET_RES_DEG)
            self.elevation_grid = grid.elevation
        except Exception:
            self.elevation_grid = np.zeros((self.rows, self.cols), dtype=np.float32)

    def latlon_to_rowcol(self, lat: float, lon: float) -> tuple[int, int, bool]:
        """Convert WGS84 lat/lon to simulation grid row and col.
        Returns (row, col, is_in_bounds)."""
        west = self.bounds["west"]
        south = self.bounds["south"]
        east = self.bounds["east"]
        north = self.bounds["north"]

        if not (west <= lon <= east and south <= lat <= north):
            return -1, -1, False

        row, col = rasterio.transform.rowcol(self.transform, lon, lat)
        if 0 <= row < self.rows and 0 <= col < self.cols:
            return int(row), int(col), True
        return -1, -1, False

    def query_point(self, lat: float, lon: float, threshold_m: float = 0.1) -> dict:
        """Query spatial flood metrics, arrival time, and full temporal series for a given lat/lon."""
        row, col, in_bounds = self.latlon_to_rowcol(lat, lon)
        if not in_bounds:
            return {
                "in_bounds": False,
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "message": "Selected coordinates are outside the simulation domain bounds.",
                "bounds": self.bounds,
            }

        depth_series = self.depth_stack[:, row, col]
        u_series = self.u_stack[:, row, col]
        v_series = self.v_stack[:, row, col]
        vel_series = np.sqrt(u_series**2 + v_series**2)

        wet_mask = depth_series >= threshold_m
        wet_indices = np.where(wet_mask)[0]

        arrival_time_min = int(self.times_minutes[wet_indices[0]]) if len(wet_indices) > 0 else None
        arrival_time_s = float(self.times_seconds[wet_indices[0]]) if len(wet_indices) > 0 else None

        max_depth_m = float(np.nanmax(depth_series))
        max_vel_mps = float(np.nanmax(vel_series))

        elev_m = float(self.elevation_grid[row, col]) if self.elevation_grid is not None else 0.0

        timeseries = []
        for i in range(len(self.times_minutes)):
            d = float(depth_series[i])
            u = float(u_series[i])
            v = float(v_series[i])
            spd = float(vel_series[i])
            timeseries.append({
                "frame_index": i,
                "t_minutes": self.times_minutes[i],
                "t_seconds": self.times_seconds[i],
                "depth_m": round(max(0.0, d), 3),
                "u_mps": round(u, 3),
                "v_mps": round(v, 3),
                "velocity_mps": round(spd, 3),
                "is_flooded": bool(d >= threshold_m),
            })

        return {
            "in_bounds": True,
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "grid_row": row,
            "grid_col": col,
            "elevation_m": round(elev_m, 2),
            "threshold_m": threshold_m,
            "arrival_time_min": arrival_time_min,
            "arrival_time_s": arrival_time_s,
            "max_depth_m": round(max(0.0, max_depth_m), 3),
            "max_velocity_mps": round(max_vel_mps, 3),
            "timeseries": timeseries,
        }


def test_query_engine():
    """Unit test to verify coordinate transformation, point inspection, and timeseries extraction."""
    print("[test] Initializing SimulationQueryEngine...")
    engine = SimulationQueryEngine.get_engine("kosi_actual2008")
    print(f"[test] Loaded engine: {engine.rows}x{engine.cols} grid, {len(engine.times_minutes)} frames")

    # Test 1: Breach site (26.62, 87.05)
    breach_lat = engine.meta["breach_latlon"]["lat"]
    breach_lon = engine.meta["breach_latlon"]["lon"]
    res_breach = engine.query_point(breach_lat, breach_lon, threshold_m=0.1)
    assert res_breach["in_bounds"] is True, "Breach point should be in bounds"
    assert res_breach["grid_row"] == engine.meta["breach_grid_cell"][0], f"Expected row {engine.meta['breach_grid_cell'][0]}, got {res_breach['grid_row']}"
    assert res_breach["grid_col"] == engine.meta["breach_grid_cell"][1], f"Expected col {engine.meta['breach_grid_cell'][1]}, got {res_breach['grid_col']}"
    assert res_breach["max_depth_m"] > 1.0, f"Breach point max depth should be > 1m, got {res_breach['max_depth_m']}"
    assert len(res_breach["timeseries"]) == len(engine.times_minutes), "Timeseries length mismatch"
    print(f"[test] PASS: Breach query -> row={res_breach['grid_row']}, col={res_breach['grid_col']}, "
          f"arrival=T+{res_breach['arrival_time_min']}min, max_depth={res_breach['max_depth_m']}m, max_vel={res_breach['max_velocity_mps']}m/s")

    # Test 2: Out of bounds query
    res_oob = engine.query_point(20.0, 75.0)
    assert res_oob["in_bounds"] is False, "Out-of-bounds point should return in_bounds=False"
    print("[test] PASS: Out of bounds query handled correctly")

    # Test 3: High elevation / dry corner inside domain
    # North-east corner in hills or dry area
    res_dry = engine.query_point(26.68, 86.62)
    assert res_dry["in_bounds"] is True
    print(f"[test] PASS: Dry location query -> arrival={res_dry['arrival_time_min']}, max_depth={res_dry['max_depth_m']}m")

    print("[test] ALL QUERY ENGINE TESTS PASSED!")


if __name__ == "__main__":
    test_query_engine()
