"""
Generalized SRTM 30m DEM fetcher for an arbitrary AOI.

Same pipeline / same public source as scripts/fetch_dem.py (the AWS
"elevation-tiles-prod" Skadi bucket, no auth), but parameterized so the
Scenario Library can pull a real DEM for any Indian river/dam AOI.

Usage:
    python scripts/fetch_dem_aoi.py --name hirakud_mahanadi \
        --west 83.0 --south 21.0 --east 84.5 --north 22.2
"""
import argparse
import gzip
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

BASE_URL = "https://s3.amazonaws.com/elevation-tiles-prod/skadi"
HGT_SIZE = 3601


def tiles_for_bounds(west, south, east, north):
    tiles = []
    for lat in range(int(np.floor(south)), int(np.ceil(north))):
        for lon in range(int(np.floor(west)), int(np.ceil(east))):
            ns = "N" if lat >= 0 else "S"
            ew = "E" if lon >= 0 else "W"
            tiles.append(f"{ns}{abs(lat):02d}{ew}{abs(lon):03d}")
    return tiles


def download_tile(tile_id: str) -> Path:
    lat_band = tile_id[:3]
    url = f"{BASE_URL}/{lat_band}/{tile_id}.hgt.gz"
    dest_gz = RAW_DIR / f"{tile_id}.hgt.gz"
    dest_hgt = RAW_DIR / f"{tile_id}.hgt"
    if dest_hgt.exists():
        return dest_hgt
    print(f"  downloading {url}")
    resp = requests.get(url, timeout=90)
    resp.raise_for_status()
    dest_gz.write_bytes(resp.content)
    with gzip.open(dest_gz, "rb") as f_in, open(dest_hgt, "wb") as f_out:
        shutil.copyfileobj(f_in, f_out)
    dest_gz.unlink()
    return dest_hgt


def hgt_to_geotiff(hgt_path: Path, tile_id: str) -> Path:
    lat = (1 if tile_id[0] == "N" else -1) * int(tile_id[1:3])
    lon = (1 if tile_id[3] == "E" else -1) * int(tile_id[4:7])
    data = np.fromfile(hgt_path, dtype=">i2").reshape(HGT_SIZE, HGT_SIZE).astype(np.int16)
    transform = rasterio.transform.from_bounds(lon, lat, lon + 1, lat + 1, HGT_SIZE, HGT_SIZE)
    out_path = RAW_DIR / f"{tile_id}.tif"
    with rasterio.open(
        out_path, "w", driver="GTiff", height=HGT_SIZE, width=HGT_SIZE,
        count=1, dtype="int16", crs="EPSG:4326", transform=transform,
        nodata=-32768, compress="DEFLATE",
    ) as dst:
        dst.write(data, 1)
    return out_path


def fetch_dem_aoi(name: str, west: float, south: float, east: float, north: float) -> Path:
    tile_ids = tiles_for_bounds(west, south, east, north)
    print(f"Fetching {len(tile_ids)} SRTM tiles for '{name}': {tile_ids}")
    tif_paths = [hgt_to_geotiff(download_tile(t), t) for t in tile_ids]

    srcs = [rasterio.open(p) for p in tif_paths]
    mosaic, out_transform = merge(srcs)
    out_meta = srcs[0].meta.copy()
    out_meta.update(driver="GTiff", height=mosaic.shape[1], width=mosaic.shape[2],
                    transform=out_transform, compress="DEFLATE")
    merged_path = RAW_DIR / f"{name}_merged.tif"
    with rasterio.open(merged_path, "w", **out_meta) as dst:
        dst.write(mosaic)
    for s in srcs:
        s.close()

    with rasterio.open(merged_path) as src:
        window = from_bounds(west, south, east, north, transform=src.transform)
        clipped = src.read(1, window=window)
        clip_transform = src.window_transform(window)
        meta = src.meta.copy()
        meta.update(height=clipped.shape[0], width=clipped.shape[1],
                    transform=clip_transform, compress="DEFLATE", nodata=-32768)
        final_path = DEM_DIR / f"{name}_srtm30m.tif"
        with rasterio.open(final_path, "w", **meta) as dst:
            dst.write(clipped, 1)

    valid = clipped[clipped != -32768]
    print(f"Done: {final_path}  shape={clipped.shape}  elev {valid.min()}-{valid.max()} m")
    return final_path


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--west", type=float, required=True)
    ap.add_argument("--south", type=float, required=True)
    ap.add_argument("--east", type=float, required=True)
    ap.add_argument("--north", type=float, required=True)
    a = ap.parse_args()
    fetch_dem_aoi(a.name, a.west, a.south, a.east, a.north)
