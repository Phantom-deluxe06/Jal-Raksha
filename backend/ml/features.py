"""Feature construction shared by training and inference: builds the 3-channel
input tensor (normalized elevation, breach-distance field, discharge field)
and depth-normalization helpers. Padding keeps spatial dims divisible by 8
(required by the 3-level U-Net's pooling/upsampling)."""
import numpy as np

PAD_MULTIPLE = 8
ELEV_MIN, ELEV_MAX = 0.0, 200.0      # AOI elevation is ~34-200m in the flood-relevant lowlands
DEPTH_NORM = 5.0                      # depths in this scenario top out around 2-3m; leaves headroom


def pad_to_multiple(arr: np.ndarray, multiple: int = PAD_MULTIPLE):
    h, w = arr.shape[-2:]
    pad_h = (-h) % multiple
    pad_w = (-w) % multiple
    if arr.ndim == 2:
        padded = np.pad(arr, ((0, pad_h), (0, pad_w)), mode="edge")
    else:
        padded = np.pad(arr, ((0, 0), (0, pad_h), (0, pad_w)), mode="edge")
    return padded, (h, w)


def unpad(arr: np.ndarray, orig_shape: tuple):
    h, w = orig_shape
    return arr[..., :h, :w]


def breach_distance_field(rows: int, cols: int, breach_row: int, breach_col: int) -> np.ndarray:
    yy, xx = np.mgrid[0:rows, 0:cols]
    dist = np.sqrt((yy - breach_row) ** 2 + (xx - breach_col) ** 2)
    return (dist / max(rows, cols)).astype(np.float32)  # normalized 0..~1.4


def build_input(elevation: np.ndarray, breach_row: int, breach_col: int,
                 discharge_cumecs: float, discharge_range: tuple) -> tuple[np.ndarray, tuple]:
    rows, cols = elevation.shape
    elev_norm = np.clip((elevation - ELEV_MIN) / (ELEV_MAX - ELEV_MIN), 0, 1).astype(np.float32)
    dist_field = breach_distance_field(rows, cols, breach_row, breach_col)
    q_lo, q_hi = discharge_range
    q_norm = float(np.clip((discharge_cumecs - q_lo) / (q_hi - q_lo), 0, 1))
    discharge_field = np.full((rows, cols), q_norm, dtype=np.float32)

    x = np.stack([elev_norm, dist_field, discharge_field], axis=0)  # (3, rows, cols)
    x_padded, orig_shape = pad_to_multiple(x)
    return x_padded, orig_shape
