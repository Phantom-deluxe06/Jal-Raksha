import numpy as np
import time
import math
import rasterio
from pathlib import Path
from rasterio.transform import rowcol

class GenericHydrodynamicEngine:
    def __init__(self, dem_path: str, output_dir: str):
        self.dem_path = dem_path
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
    def run(self, 
            breach_lat: float, 
            breach_lon: float, 
            inflow_hydrograph: np.ndarray, 
            dt_sec: float, 
            total_duration_hr: float, 
            snapshot_interval_min: float,
            manning_n: float = 0.035,
            progress_callback=None):
            
        print(f"[GenericHydrodynamicEngine] Loading DEM {self.dem_path}...")
        with rasterio.open(self.dem_path) as src:
            Z = src.read(1).astype(np.float32)
            transform = src.transform
            meta = src.meta.copy()
            dx = transform[0]
            dy = -transform[4]  # pixel height is usually negative
            
            # Convert degree to meters if DEM is in geographic CRS
            if src.crs and src.crs.is_geographic:
                # Approximate 1 degree to meters at the center latitude
                center_lat = src.bounds.bottom + (src.bounds.top - src.bounds.bottom) / 2
                dx = dx * 111320.0 * math.cos(math.radians(center_lat))
                dy = dy * 111320.0
                
            # Find breach index
            r_breach, c_breach = rowcol(transform, breach_lon, breach_lat)
        
        # Grid Setup
        ny, nx = Z.shape
        h = np.zeros_like(Z, dtype=np.float32)
        qx = np.zeros_like(Z, dtype=np.float32)
        qy = np.zeros_like(Z, dtype=np.float32)
        
        # Parameters
        g = 9.81
        n2 = manning_n ** 2
        h_dry = 0.001
        
        total_iterations = int((total_duration_hr * 3600) / dt_sec)
        snapshot_steps = int((snapshot_interval_min * 60) / dt_sec)
        total_snapshots = int((total_duration_hr * 60) / snapshot_interval_min)
        
        # Mass tracking
        cumulative_inflow_vol = 0.0
        cell_area = dx * dy
        
        frame_idx = 0
        start_time = time.time()
        
        # Initialize outputs
        def save_frame(frame, depth, u, v):
            meta.update({"dtype": "float32", "count": 1})
            
            with rasterio.open(self.output_dir / f"depth_t{frame:04d}.tif", "w", **meta) as dst:
                dst.write(depth, 1)
            with rasterio.open(self.output_dir / f"u_t{frame:04d}.tif", "w", **meta) as dst:
                dst.write(u, 1)
            with rasterio.open(self.output_dir / f"v_t{frame:04d}.tif", "w", **meta) as dst:
                dst.write(v, 1)

        # Pre-allocate for intermediate arrays
        h_f_x = np.zeros_like(Z)
        h_f_y = np.zeros_like(Z)
        
        # Initial snapshot
        save_frame(0, h, np.zeros_like(Z), np.zeros_like(Z))
        frame_idx += 1
        
        for t in range(total_iterations):
            # Source injection
            Q_in = inflow_hydrograph[t]
            vol_in = Q_in * dt_sec
            cumulative_inflow_vol += vol_in
            
            # Inject at breach cell (spread over a 3x3 if needed, but 1 cell for simplicity)
            r_b = max(0, min(ny-1, r_breach))
            c_b = max(0, min(nx-1, c_breach))
            h[r_b, c_b] += vol_in / cell_area
            
            # Compute Water Surface Elevation (WSE)
            wse = Z + h
            
            # --- X-direction Flux (qx) ---
            # Staggered grid difference: h_f_x[j, i] uses (h[j,i] + h[j,i+1])/2
            dh_dx = (wse[:, 1:] - wse[:, :-1]) / dx
            h_f_x[:, :-1] = np.maximum(h[:, :-1], h[:, 1:]) # Upwind depth approximation
            
            # Only flow where depth > dry tolerance
            wet_x = h_f_x[:, :-1] > h_dry
            
            # Local Inertial Equation for qx
            q_old_x = qx[:, :-1]
            friction_x = g * dt_sec * n2 * np.abs(q_old_x) / (h_f_x[:, :-1]**(7/3) + 1e-6)
            
            qx[:, :-1][wet_x] = (q_old_x[wet_x] - g * h_f_x[:, :-1][wet_x] * dt_sec * dh_dx[wet_x]) / (1.0 + friction_x[wet_x])
            qx[:, :-1][~wet_x] = 0.0
            
            # --- Y-direction Flux (qy) ---
            dh_dy = (wse[1:, :] - wse[:-1, :]) / dy
            h_f_y[:-1, :] = np.maximum(h[:-1, :], h[1:, :])
            
            wet_y = h_f_y[:-1, :] > h_dry
            
            q_old_y = qy[:-1, :]
            friction_y = g * dt_sec * n2 * np.abs(q_old_y) / (h_f_y[:-1, :]**(7/3) + 1e-6)
            
            qy[:-1, :][wet_y] = (q_old_y[wet_y] - g * h_f_y[:-1, :][wet_y] * dt_sec * dh_dy[wet_y]) / (1.0 + friction_y[wet_y])
            qy[:-1, :][~wet_y] = 0.0
            
            # --- Flux Limiter to Prevent Mass Creation ---
            out_vol = np.zeros_like(h)
            out_vol[:, :-1] += np.maximum(qx[:, :-1], 0) * dt_sec * dy # flows right from i,j
            out_vol[:, 1:] += np.maximum(-qx[:, :-1], 0) * dt_sec * dy # flows left from i,j+1
            out_vol[:-1, :] += np.maximum(qy[:-1, :], 0) * dt_sec * dx # flows down from i,j
            out_vol[1:, :] += np.maximum(-qy[:-1, :], 0) * dt_sec * dx # flows up from i+1,j
            
            avail_vol = h * dx * dy
            scale = np.ones_like(h)
            over = out_vol > avail_vol
            scale[over] = avail_vol[over] / (out_vol[over] + 1e-6)
            
            scale_x = np.where(qx[:, :-1] > 0, scale[:, :-1], scale[:, 1:])
            qx[:, :-1] *= scale_x
            
            scale_y = np.where(qy[:-1, :] > 0, scale[:-1, :], scale[1:, :])
            qy[:-1, :] *= scale_y

            # --- Mass Conservation (Continuity Equation) ---
            dqx = np.zeros_like(h)
            dqx[:, 1:] += qx[:, :-1]  # Inflow from left
            dqx[:, :-1] -= qx[:, :-1] # Outflow to right
            dqx /= dx
            
            dqy = np.zeros_like(h)
            dqy[1:, :] += qy[:-1, :]  # Inflow from top
            dqy[:-1, :] -= qy[:-1, :] # Outflow to bottom
            dqy /= dy
            
            # Depth update
            h += dt_sec * (dqx + dqy)
            # Remove the h[h < h_dry] = 0.0 cap because the flux limiter guarantees positivity, 
            # and capping ruins strict mass conservation. 
            # We just clamp extremely small negative values due to floating point error.
            h[h < 0] = 0.0
            
            # Snapshot & Callback
            if (t + 1) % snapshot_steps == 0 or t == total_iterations - 1:
                # Calculate metrics
                total_volume_on_grid = float(np.sum(h)) * float(cell_area)
                mass_error_pct = 0.0
                if cumulative_inflow_vol > 0:
                    mass_error_pct = float(((total_volume_on_grid - cumulative_inflow_vol) / cumulative_inflow_vol) * 100.0)
                
                # Derive velocity u, v
                u = np.zeros_like(h)
                v = np.zeros_like(h)
                wet = h > h_dry
                u[wet] = qx[wet] / h[wet]
                v[wet] = qy[wet] / h[wet]
                
                save_frame(frame_idx, h, u, v)
                
                print(f"DEBUG [{t}]: vol={total_volume_on_grid:.2f} in={cumulative_inflow_vol:.2f} err={mass_error_pct:.2f}% max_depth={float(np.max(h)):.2f}")
                
                if progress_callback:
                    progress_callback(frame_idx, total_snapshots, mass_error_pct)
                    
                frame_idx += 1
                
        run_time_sec = time.time() - start_time
        
        # Final Metrics
        max_depth = float(np.max(h))
        wet_cells = float(np.sum(h > h_dry))
        max_extent_km2 = float((wet_cells * cell_area) / 1e6)
        u = np.where(h > h_dry, qx / (h + 1e-6), 0)
        v = np.where(h > h_dry, qy / (h + 1e-6), 0)
        peak_velocity = float(np.max(np.sqrt(u**2 + v**2)))
        
        return {
            "max_depth_m": float(round(max_depth, 2)),
            "max_extent_km2": float(round(max_extent_km2, 2)),
            "peak_velocity_m_s": float(round(peak_velocity, 2)),
            "mass_conservation_delta_pct": float(round(mass_error_pct, 4)),
            "run_time_sec": float(round(run_time_sec, 2)),
            "frames_generated": int(frame_idx)
        }
