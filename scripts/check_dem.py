import numpy as np
import rasterio

with rasterio.open("data/dem/kosi_aoi_srtm30m.tif") as src:
    data = src.read(1)
    valid = data[data != src.nodata]
    print(f"bounds: {src.bounds}")
    print(f"shape: {data.shape}, res: {src.res}")
    print(f"elevation min/mean/max: {valid.min()}/{valid.mean():.1f}/{valid.max()}")
    # north strip (near Kusaha/Nepal, higher) vs south strip (Bihar plains, lower)
    n = data.shape[0]
    north = data[: n // 4]
    south = data[3 * n // 4 :]
    north_v = north[north != src.nodata]
    south_v = south[south != src.nodata]
    print(f"north quarter mean elev: {north_v.mean():.1f} m")
    print(f"south quarter mean elev: {south_v.mean():.1f} m")
