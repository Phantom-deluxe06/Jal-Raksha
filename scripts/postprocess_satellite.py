"""Downsample the full-res Sentinel-2 TCI mosaic (10m, 154MB) to a
web/demo-friendly resolution and emit a PNG preview for visual sanity-check."""
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling

SAT_DIR = Path(__file__).resolve().parent.parent / "data" / "satellite"
SRC = SAT_DIR / "kosi_aoi_sentinel2_tci_20231228.tif"
DOWNSAMPLE_FACTOR = 4  # 10m -> 40m

def main():
    with rasterio.open(SRC) as src:
        new_h, new_w = src.height // DOWNSAMPLE_FACTOR, src.width // DOWNSAMPLE_FACTOR
        data = src.read(
            out_shape=(src.count, new_h, new_w),
            resampling=Resampling.average,
        )
        new_transform = src.transform * src.transform.scale(
            src.width / new_w, src.height / new_h
        )
        meta = src.meta.copy()
        meta.update(
            height=new_h, width=new_w, transform=new_transform,
            compress="DEFLATE", predictor=2,
        )

    out_path = SAT_DIR / "kosi_aoi_sentinel2_tci_20231228_40m.tif"
    with rasterio.open(out_path, "w", **meta) as dst:
        dst.write(data)

    # PNG preview for quick visual check
    rgb = np.moveaxis(data, 0, -1)
    png_path = SAT_DIR / "preview.png"
    Image.fromarray(rgb).save(png_path)

    print(f"Downsampled: {out_path} ({out_path.stat().st_size / 1e6:.1f} MB), shape {data.shape}")
    print(f"Preview: {png_path}")

    SRC.unlink()
    print(f"Removed full-res original ({SRC.name})")


if __name__ == "__main__":
    main()
