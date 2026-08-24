"""DEM loading and downsampling for the SWE solver grid."""
from dataclasses import dataclass

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject
from rasterio.transform import Affine


@dataclass
class Grid:
    elevation: np.ndarray      # (rows, cols) float32, meters
    transform: Affine
    crs: object
    dx: float                  # cell width, meters (approx, at grid center latitude)
    dy: float                  # cell height, meters
    rows: int
    cols: int


def load_dem_grid(dem_path: str, target_res_deg: float) -> Grid:
    """Load a DEM GeoTIFF and resample (block-average) it to a coarser,
    solver-tractable resolution. target_res_deg is in decimal degrees
    (the source DEM is EPSG:4326)."""
    with rasterio.open(dem_path) as src:
        assert src.crs.to_epsg() == 4326, "expected EPSG:4326 DEM"
        west, south, east, north = src.bounds
        new_width = max(1, round((east - west) / target_res_deg))
        new_height = max(1, round((north - south) / target_res_deg))
        new_transform = rasterio.transform.from_bounds(
            west, south, east, north, new_width, new_height
        )
        dest = np.empty((new_height, new_width), dtype=np.float32)
        reproject(
            source=rasterio.band(src, 1),
            destination=dest,
            src_transform=src.transform,
            src_crs=src.crs,
            dst_transform=new_transform,
            dst_crs=src.crs,
            resampling=Resampling.average,
            src_nodata=src.nodata,
            dst_nodata=np.nan,
        )
        if np.isnan(dest).any():
            # fill any residual nodata (shouldn't occur inland) with nearest valid
            from scipy.ndimage import distance_transform_edt
            mask = np.isnan(dest)
            idx = distance_transform_edt(mask, return_distances=False, return_indices=True)
            dest = dest[tuple(idx)]

        center_lat = (north + south) / 2
        m_per_deg_lat = 111_320.0
        m_per_deg_lon = 111_320.0 * np.cos(np.radians(center_lat))
        dx = target_res_deg * m_per_deg_lon
        dy = target_res_deg * m_per_deg_lat

        return Grid(
            elevation=dest,
            transform=new_transform,
            crs=src.crs,
            dx=float(dx),
            dy=float(dy),
            rows=new_height,
            cols=new_width,
        )


def latlon_to_rowcol(grid: Grid, lat: float, lon: float) -> tuple[int, int]:
    row, col = rasterio.transform.rowcol(grid.transform, lon, lat)
    row = int(np.clip(row, 0, grid.rows - 1))
    col = int(np.clip(col, 0, grid.cols - 1))
    return row, col
