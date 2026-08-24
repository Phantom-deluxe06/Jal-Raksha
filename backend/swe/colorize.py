"""Depth-grid -> RGBA colour ramp for Leaflet image overlays."""
import numpy as np

# (depth_m, R, G, B) stops -- light blue (shallow) to dark blue/purple (deep)
STOPS = [
    (0.0, 173, 216, 230),
    (0.5, 100, 181, 246),
    (1.5, 33, 150, 243),
    (3.0, 25, 90, 200),
    (6.0, 13, 40, 130),
    (10.0, 60, 10, 90),
]


def colorize_depth(depth: np.ndarray, dry_threshold: float = 0.1, alpha: int = 190) -> np.ndarray:
    """Return an (rows, cols, 4) uint8 RGBA array; dry cells fully transparent."""
    depths = [s[0] for s in STOPS]
    rows = np.array([s[1:] for s in STOPS], dtype=np.float64)
    d_clamped = np.clip(depth, depths[0], depths[-1])

    r = np.interp(d_clamped, depths, rows[:, 0])
    g = np.interp(d_clamped, depths, rows[:, 1])
    b = np.interp(d_clamped, depths, rows[:, 2])

    rgba = np.zeros((*depth.shape, 4), dtype=np.uint8)
    rgba[..., 0] = r
    rgba[..., 1] = g
    rgba[..., 2] = b
    wet = depth >= dry_threshold
    rgba[..., 3] = np.where(wet, alpha, 0)
    return rgba
