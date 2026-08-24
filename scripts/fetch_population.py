"""
Fetch a clipped population-density raster for the Kosi AOI from WorldPop's
public India 1km population-count GeoTIFF (whole-country file is ~19MB, so
it's downloaded directly rather than via range requests -- the 100m country
file is ~1.8GB and its host does not honor HTTP Range despite advertising
Accept-Ranges, so windowed /vsicurl/ reads aren't usable there).
"""
from pathlib import Path

import rasterio
import requests
from rasterio.windows import from_bounds

SRC_URL = (
    "https://data.worldpop.org/GIS/Population/Global_2000_2020_1km/"
    "2020/IND/ind_ppp_2020_1km_Aggregated.tif"
)

# Same AOI as the DEM (Kusaha breach -> Kosi Barrage -> Bihar flood corridor)
AOI_BOUNDS = dict(west=86.6, south=25.9, east=87.3, north=26.7)

OUT_DIR = Path(__file__).resolve().parent.parent / "data" / "population"
RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"
OUT_DIR.mkdir(parents=True, exist_ok=True)
RAW_DIR.mkdir(parents=True, exist_ok=True)


def main():
    local_path = RAW_DIR / "ind_ppp_2020_1km_Aggregated.tif"
    if not local_path.exists():
        print(f"Downloading {SRC_URL}")
        resp = requests.get(SRC_URL, timeout=120)
        resp.raise_for_status()
        local_path.write_bytes(resp.content)
        print(f"  -> {local_path.name} ({local_path.stat().st_size / 1e6:.1f} MB)")

    with rasterio.open(local_path) as src:
        print(f"  source size: {src.width}x{src.height}, dtype={src.dtypes[0]}")
        window = from_bounds(
            AOI_BOUNDS["west"], AOI_BOUNDS["south"],
            AOI_BOUNDS["east"], AOI_BOUNDS["north"],
            transform=src.transform,
        )
        data = src.read(1, window=window)
        out_transform = src.window_transform(window)
        meta = src.meta.copy()
        meta.update(
            height=data.shape[0], width=data.shape[1],
            transform=out_transform, compress="DEFLATE",
        )

    out_path = OUT_DIR / "kosi_aoi_worldpop_2020.tif"
    with rasterio.open(out_path, "w", **meta) as dst:
        dst.write(data, 1)

    valid = data[data > 0]
    print(f"\nDone: {out_path}")
    print(f"  shape: {data.shape}")
    print(f"  total estimated population in AOI: {valid.sum():,.0f}")
    print(f"  max people/pixel (~100m cell): {valid.max():.1f}")


if __name__ == "__main__":
    main()
