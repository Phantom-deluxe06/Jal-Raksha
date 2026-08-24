"""
Fetch a real Sentinel-2 L2A true-colour (TCI) mosaic for the Kosi AOI from the
public Earth Search STAC API / sentinel-cogs S3 bucket (AWS Open Data, no auth
required). Uses GDAL's /vsicurl/ range-request reads against the
Cloud-Optimized GeoTIFF assets, so only the AOI-intersecting blocks are
pulled -- not the full ~110MB/tile scene.
"""
from pathlib import Path

import rasterio
from rasterio.merge import merge
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds

# Same scene date across all 4 MGRS tiles intersecting the AOI (low cloud, Dec 2023)
SCENE_DATE = "2023/12/S2B_{tile}_20231228_0_L2A"
TILES = ["45RVJ", "45RWJ", "45RVK", "45RWK"]
BASE = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs"

AOI_BOUNDS = dict(west=86.6, south=25.9, east=87.3, north=26.7)  # WGS84

OUT_DIR = Path(__file__).resolve().parent.parent / "data" / "satellite"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def tile_url(tile: str) -> str:
    grid, sq = tile[:2], tile[2:]
    return f"/vsicurl/{BASE}/{grid}/{sq[0]}/{sq[1:]}/{SCENE_DATE.format(tile=tile)}/TCI.tif"


def main():
    print("Opening Sentinel-2 TCI COGs via range requests and clipping to AOI...")
    clips = []
    ref_crs = None
    for tile in TILES:
        url = tile_url(tile)
        print(f"  {tile}: {url}")
        with rasterio.open(url) as src:
            if ref_crs is None:
                ref_crs = src.crs
            bounds_in_crs = transform_bounds(
                "EPSG:4326", src.crs,
                AOI_BOUNDS["west"], AOI_BOUNDS["south"],
                AOI_BOUNDS["east"], AOI_BOUNDS["north"],
            )
            window = from_bounds(*bounds_in_crs, transform=src.transform)
            window = window.intersection(
                rasterio.windows.Window(0, 0, src.width, src.height)
            )
            if window.width <= 0 or window.height <= 0:
                print(f"    (no overlap with AOI, skipping)")
                continue
            data = src.read(window=window)
            transform = src.window_transform(window)
            meta = src.meta.copy()
            meta.update(
                height=data.shape[1], width=data.shape[2], transform=transform
            )
            clip_path = OUT_DIR / f"_clip_{tile}.tif"
            with rasterio.open(clip_path, "w", **meta) as dst:
                dst.write(data)
            clips.append(clip_path)

    print("Merging clipped tiles...")
    srcs = [rasterio.open(p) for p in clips]
    mosaic, out_transform = merge(srcs)
    meta = srcs[0].meta.copy()
    meta.update(
        height=mosaic.shape[1], width=mosaic.shape[2],
        transform=out_transform, compress="DEFLATE",
    )
    out_path = OUT_DIR / "kosi_aoi_sentinel2_tci_20231228.tif"
    with rasterio.open(out_path, "w", **meta) as dst:
        dst.write(mosaic)
    for s in srcs:
        s.close()
    for p in clips:
        p.unlink()

    print(f"\nDone: {out_path}")
    print(f"  shape: {mosaic.shape}, CRS: {meta['crs']}")
    print("  source: Sentinel-2 L2A, tiles 45RVJ/45RWJ/45RVK/45RWK, 2023-12-28, ESA/Copernicus via AWS Earth Search")


if __name__ == "__main__":
    main()
