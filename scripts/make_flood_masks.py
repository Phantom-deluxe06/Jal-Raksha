import rasterio
import numpy as np
from PIL import Image
from pathlib import Path

src_dir = Path("backend/outputs/swe_kosi_actual2008/frames")
out_dir = Path("backend/outputs/swe_kosi_actual2008/flood_masks")
out_dir.mkdir(exist_ok=True)

files = sorted(src_dir.glob("depth_*.tif"))

for tif in files:
    with rasterio.open(tif) as src:
        depth = src.read(1).astype(np.float32)
        nodata = src.nodata

    valid = np.isfinite(depth)

    if nodata is not None:
        valid &= depth != nodata

    # Only show meaningful flood depth.
    wet = valid & (depth > 0.1)

    # Normalize depth to 0-255 using the physical maximum of 2.125 m.
    normalized = np.clip(depth / 2.125, 0.0, 1.0)

    # Blue water color, with transparency outside flooded cells.
    r = np.full(depth.shape, 20, dtype=np.uint8)
    g = (100 + normalized * 100).astype(np.uint8)
    b = np.full(depth.shape, 255, dtype=np.uint8)

    alpha = np.where(wet, 170 + normalized * 70, 0).astype(np.uint8)

    rgba = np.dstack((r, g, b, alpha))

    out = out_dir / (tif.stem + ".png")
    Image.fromarray(rgba, "RGBA").save(out)

    print(f"Created: {out}")

print(f"\nDone. Created {len(files)} flood masks.")
