"""
Unreal Engine 5 hydraulic time-series export pipeline (Track C).

Packages a completed SWE scenario into assets a UE5 artist can drop straight
into the Niagara / Water plugin:

  * dem_heightmap.png        -- 16-bit grayscale, UE5 Landscape import
  * flow_vectors_tXXXX.png   -- 8-bit RGBA, R=U  G=V  B=depth(H)  A=255
  * scenario_manifest.json   -- real-world geo-referencing + channel decode ranges

Everything is bundled into a single .zip returned by
GET /api/export/{scenario_id}/ue5-package
"""
from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
import rasterio
from PIL import Image

BACKEND_DIR = Path(__file__).resolve().parent.parent
OUTPUTS_DIR = BACKEND_DIR / "outputs"


def _resolve_scenario_dir(scenario_id: str) -> Path:
    candidates = [
        OUTPUTS_DIR / f"swe_{scenario_id}",
        OUTPUTS_DIR / scenario_id,
    ]
    if scenario_id in ("kosi_actual2008", "kosi_2008_historical"):
        candidates.insert(0, OUTPUTS_DIR / "swe_kosi_actual2008")
    for c in candidates:
        if (c / "metadata.json").exists():
            return c
    raise FileNotFoundError(
        f"No completed scenario '{scenario_id}' found under {OUTPUTS_DIR}."
    )


def _norm16(arr: np.ndarray) -> tuple[np.ndarray, float, float]:
    a = np.nan_to_num(arr.astype(np.float64), nan=0.0)
    lo, hi = float(np.min(a)), float(np.max(a))
    span = hi - lo if hi > lo else 1.0
    out = ((a - lo) / span * 65535.0).clip(0, 65535).astype(np.uint16)
    return out, lo, hi


def _norm8_signed(arr: np.ndarray, absmax: float) -> np.ndarray:
    """Map [-absmax, +absmax] -> [0, 255] with 128 == 0."""
    m = absmax if absmax > 1e-9 else 1.0
    scaled = ((np.nan_to_num(arr) / m) * 0.5 + 0.5).clip(0.0, 1.0)
    return (scaled * 255.0).astype(np.uint8)


def _norm8_pos(arr: np.ndarray, hi: float) -> np.ndarray:
    m = hi if hi > 1e-9 else 1.0
    return ((np.nan_to_num(arr) / m).clip(0.0, 1.0) * 255.0).astype(np.uint8)


class UE5ExportService:
    def __init__(self, scenario_id: str):
        self.scenario_id = scenario_id
        self.sim_dir = _resolve_scenario_dir(scenario_id)
        self.meta: Dict[str, Any] = json.loads(
            (self.sim_dir / "metadata.json").read_text(encoding="utf-8")
        )

    # ------------------------------------------------------------------ DEM
    def _build_heightmap(self) -> tuple[bytes, float, float]:
        frames = self.meta.get("frames", [])
        ref_tif = self.sim_dir / frames[0]["depth_tif"] if frames else None

        elev = None
        try:
            from swe.dem_utils import load_dem_grid  # noqa: E402
            from swe.scenario_runner import DEM_DEFAULT_PATH  # noqa: E402

            grid = load_dem_grid(
                str(DEM_DEFAULT_PATH),
                self.meta.get("grid", {}).get("target_res_deg", 0.0016667),
            )
            elev = grid.elevation
        except Exception:
            elev = None

        if elev is None and ref_tif and ref_tif.exists():
            with rasterio.open(ref_tif) as src:
                elev = np.zeros(src.shape, dtype=np.float32)

        if elev is None:
            rows = self.meta.get("grid", {}).get("rows", 256)
            cols = self.meta.get("grid", {}).get("cols", 256)
            elev = np.zeros((rows, cols), dtype=np.float32)

        png16, lo, hi = _norm16(elev)
        buf = io.BytesIO()
        Image.fromarray(png16, mode="I;16").save(buf, format="PNG")
        return buf.getvalue(), lo, hi

    # -------------------------------------------------------------- flow seq
    def _flow_frames(self):
        frames = self.meta.get("frames", [])
        # global normalisation ranges so the whole sequence is consistent
        u_absmax = v_absmax = h_max = 1e-6
        depth_maps: List[np.ndarray] = []
        uv_maps: List[tuple[np.ndarray, np.ndarray]] = []
        for f in frames:
            with rasterio.open(self.sim_dir / f["depth_tif"]) as src:
                d = src.read(1)
            try:
                with rasterio.open(self.sim_dir / f["u_tif"]) as src:
                    u = src.read(1)
                with rasterio.open(self.sim_dir / f["v_tif"]) as src:
                    v = src.read(1)
            except Exception:
                u = np.zeros_like(d)
                v = np.zeros_like(d)
            depth_maps.append(d)
            uv_maps.append((u, v))
            u_absmax = max(u_absmax, float(np.nanmax(np.abs(u))))
            v_absmax = max(v_absmax, float(np.nanmax(np.abs(v))))
            h_max = max(h_max, float(np.nanmax(d)))

        out = []
        for i, f in enumerate(frames):
            u, v = uv_maps[i]
            d = depth_maps[i]
            rgba = np.zeros((*d.shape, 4), dtype=np.uint8)
            rgba[..., 0] = _norm8_signed(u, u_absmax)
            rgba[..., 1] = _norm8_signed(v, v_absmax)
            rgba[..., 2] = _norm8_pos(d, h_max)
            rgba[..., 3] = 255
            buf = io.BytesIO()
            Image.fromarray(rgba, mode="RGBA").save(buf, format="PNG")
            t_min = int(f.get("t_minutes", i))
            out.append((f"flow_vectors_t{t_min:04d}.png", buf.getvalue()))
        return out, u_absmax, v_absmax, h_max

    # ----------------------------------------------------------------- zip
    def build_package(self, out_path: str) -> str:
        b = self.meta.get("bounds", {})
        grid = self.meta.get("grid", {})
        rows = grid.get("rows", 0)
        cols = grid.get("cols", 0)

        heightmap_png, elev_lo, elev_hi = self._build_heightmap()
        flow_pngs, u_absmax, v_absmax, h_max = self._flow_frames()

        manifest = {
            "scenario_id": self.scenario_id,
            "scenario_label": self.meta.get("scenario_label", self.scenario_id),
            "generator": "FloodSim-HADR UE5 Export Pipeline v1",
            "grid": {"rows": rows, "cols": cols},
            "origin_lat": b.get("south"),
            "origin_lon": b.get("west"),
            "extent": b,
            "scale_x_meters": float(grid.get("dx_m", 0.0)) * cols,
            "scale_y_meters": float(grid.get("dy_m", 0.0)) * rows,
            "cell_size_x_meters": grid.get("dx_m"),
            "cell_size_y_meters": grid.get("dy_m"),
            "max_depth_meters": self.meta.get("max_depth_m", h_max),
            "heightmap": {
                "file": "dem_heightmap.png",
                "format": "16-bit grayscale PNG",
                "elevation_min_meters": elev_lo,
                "elevation_max_meters": elev_hi,
                "decode": "elev = min + (pixel/65535)*(max-min)",
            },
            "flow_sequence": {
                "files": [n for n, _ in flow_pngs],
                "format": "8-bit RGBA PNG",
                "channels": {
                    "R": "U velocity (east+)  m/s",
                    "G": "V velocity (north+) m/s",
                    "B": "water depth H  m",
                    "A": "unused (255)",
                },
                "decode": {
                    "U_mps": f"(R/255 - 0.5) * 2 * {u_absmax:.4f}",
                    "V_mps": f"(G/255 - 0.5) * 2 * {v_absmax:.4f}",
                    "H_m": f"(B/255) * {h_max:.4f}",
                },
                "u_abs_max_mps": u_absmax,
                "v_abs_max_mps": v_absmax,
                "h_max_m": h_max,
                "frame_interval_minutes": self.meta.get("solver", {}).get(
                    "snapshot_interval_s", 900
                ) / 60.0,
            },
        }

        Path(out_path).parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("dem_heightmap.png", heightmap_png)
            for name, data in flow_pngs:
                z.writestr(name, data)
            z.writestr("scenario_manifest.json", json.dumps(manifest, indent=2, default=str))
        return out_path
