import json

import numpy as np
import torch
from torch.utils.data import Dataset

from ml import config as cfg
from ml.features import build_input, pad_to_multiple


class FloodDataset(Dataset):
    def __init__(self, split: str):
        manifest = json.loads((cfg.ML_DATA_DIR / "manifest.json").read_text())
        self.elevation = np.load(cfg.ML_DATA_DIR / "elevation.npy")
        self.discharge_range = tuple(manifest["discharge_range_cumecs"])
        self.samples = [s for s in manifest["samples"] if s["split"] == split and not s["unstable"]]
        if not self.samples:
            raise RuntimeError(f"no usable samples for split={split}")

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx):
        s = self.samples[idx]
        x, orig_shape = build_input(
            self.elevation, s["breach_row"], s["breach_col"], s["discharge_cumecs"], self.discharge_range
        )
        depth = np.load(cfg.ML_DATA_DIR / f"{s['id']}_depth.npy")
        depth_padded, _ = pad_to_multiple(depth)  # regression target, raw meters
        return torch.from_numpy(x), torch.from_numpy(depth_padded.astype(np.float32))
