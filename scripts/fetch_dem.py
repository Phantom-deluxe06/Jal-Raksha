"""
Download SRTM 30m (1 arc-second) DEM tiles covering the Kosi River case-study AOI
(Kusaha breach site, Nepal -> Kosi Barrage -> Supaul/Saharsa flood corridor, Bihar)
from the public AWS "elevation-tiles-prod" bucket (Skadi/HGT layout, no auth required),
then merges and clips them to the AOI bounding box, producing a single GeoTIFF DEM.
"""
import gzip
import io
import shutil
from pathlib import Path

import numpy as np
import rasterio
import requests
from rasterio.merge import merge
from rasterio.windows import from_bounds

RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"
DEM_DIR = Path(__file__).resolve().parent.parent / "data" / "dem"
RAW_DIR.mkdir(parents=True, exist_ok=True)
DEM_DIR.mkdir(parents=True, exist_ok=True)

# AOI: covers Kusaha (Nepal) breach site down through Kosi Barrage into the
# Bihar flood corridor (Supaul / Saharsa / Madhepura districts).
AOI_BOUNDS = dict(west=86.6, south=25.9, east=87.3, north=26.7)

TILES = ["N25E086", "N25E087", "N26E086", "N26E087"]
BASE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/skadi"

HGT_SIZE = 3601  # 1 arc-second SRTM: 3601x3601 samples per 1-degree tile


def download_tile(tile_id: str) -> Path:
    lat_band = tile_id[:3]  # e.g. N25
    url = f"{BASE_URL}/{lat_band}/{tile_id}.hgt.gz"
    dest_gz = RAW_DIR / f"{tile_id}.hgt.gz"
    dest_hgt = RAW_DIR / f"{tile_id}.hgt"
    if dest_hgt.exists():
        print(f"  {tile_id}.hgt already present, skipping download")
        return dest_hgt

    print(f"  downloading {url}")
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    dest_gz.write_bytes(resp.content)

    with gzip.open(dest_gz, "rb") as f_in, open(dest_hgt, "wb") as f_out:
        shutil.copyfileobj(f_in, f_out)
    dest_gz.unlink()
    print(f"  -> {dest_hgt.name} ({dest_hgt.stat().st_size / 1e6:.1f} MB)")
    return dest_hgt


def hgt_to_geotiff(hgt_path: Path, tile_id: str) -> Path:
    """SRTM .hgt is a raw big-endian int16 grid; wrap it with a GDAL-readable
    georeferenced GeoTIFF using the tile's known 1-degree extent."""
    lat_sign = 1 if tile_id[0] == "N" else -1
    lat = lat_sign * int(tile_id[1:3])
    lon_sign = 1 if tile_id[3] == "E" else -1
    lon = lon_sign * int(tile_id[4:7])

    data = np.fromfile(hgt_path, dtype=">i2").reshape(HGT_SIZE, HGT_SIZE)
    data = data.astype(np.int16)

    transform = rasterio.transform.from_bounds(
        lon, lat, lon + 1, lat + 1, HGT_SIZE, HGT_SIZE
    )
    out_path = RAW_DIR / f"{tile_id}.tif"
    with rasterio.open(
        out_path, "w", driver="GTiff", height=HGT_SIZE, width=HGT_SIZE,
        count=1, dtype="int16", crs="EPSG:4326", transform=transform,
        nodata=-32768, compress="DEFLATE",
    ) as dst:
        dst.write(data, 1)
    return out_path


def main():
    print("Fetching SRTM tiles for Kosi AOI...")
    tif_paths = []
    for tile_id in TILES:
        hgt_path = download_tile(tile_id)
        tif_paths.append(hgt_to_geotiff(hgt_path, tile_id))

    print("Merging tiles...")
    srcs = [rasterio.open(p) for p in tif_paths]
    mosaic, out_transform = merge(srcs)
    out_meta = srcs[0].meta.copy()
    out_meta.update(
        driver="GTiff", height=mosaic.shape[1], width=mosaic.shape[2],
        transform=out_transform, compress="DEFLATE",
    )
    merged_path = RAW_DIR / "kosi_merged.tif"
    with rasterio.open(merged_path, "w", **out_meta) as dst:
        dst.write(mosaic)
    for s in srcs:
        s.close()

    print(f"Clipping to AOI bounds {AOI_BOUNDS}...")
    with rasterio.open(merged_path) as src:
        window = from_bounds(
            AOI_BOUNDS["west"], AOI_BOUNDS["south"],
            AOI_BOUNDS["east"], AOI_BOUNDS["north"],
            transform=src.transform,
        )
        clipped = src.read(1, window=window)
        clip_transform = src.window_transform(window)
        meta = src.meta.copy()
        meta.update(
            height=clipped.shape[0], width=clipped.shape[1],
            transform=clip_transform, compress="DEFLATE", nodata=-32768,
        )
        final_path = DEM_DIR / "kosi_aoi_srtm30m.tif"
        with rasterio.open(final_path, "w", **meta) as dst:
            dst.write(clipped, 1)

    valid = clipped[clipped != -32768]
    print(f"\nDone: {final_path}")
    print(f"  shape: {clipped.shape}  (~{clipped.shape[0]*clipped.shape[1]/1e6:.1f}M px)")
    print(f"  elevation range: {valid.min()} - {valid.max()} m")


if __name__ == "__main__":
    main()
