"""
2D Shallow Water Equations solver, explicit finite-volume (Lax-Friedrichs
flux) on a regular grid -- the PRD's "implement the 2D SWE solver yourself
using a finite-volume method in Python (NumPy/SciPy)" option.

Conservative variables U = (h, hu, hv). Governing equations:
    d(h)/dt  + d(hu)/dx + d(hv)/dy = 0
    d(hu)/dt + d(hu^2 + 0.5*g*h^2)/dx + d(huv)/dy = -g*h*dz/dx - friction_x
    d(hv)/dt + d(huv)/dx + d(hv^2 + 0.5*g*h^2)/dy = -g*h*dz/dy - friction_y

Scheme: classic 2D Lax-Friedrichs (first-order, robust/diffusive, standard
teaching/demo scheme for the shallow-water / Euler system). Friction applied
as a point-implicit Manning update after the flux step (standard technique
for numerical stability at small depths). Wetting/drying handled by a
minimum-depth threshold below which velocity is zeroed.

This is a from-scratch, simplified solver, not a production hydraulic model
-- no sub-grid channel routing, no unstructured mesh, no implicit solver.
All modeling assumptions (friction coefficient, breach hydrograph shape,
open boundary conditions) are explicit parameters, not hidden defaults, and
are echoed into the run's metadata output.
"""
from dataclasses import dataclass, field

import numpy as np

G = 9.81  # m/s^2


@dataclass
class BreachSource:
    row: int
    col: int
    width_m: float
    peak_discharge_cumecs: float
    ramp_minutes: float  # time to ramp from 0 to peak (undocumented historically; assumed)

    def discharge_at(self, t_seconds: float) -> float:
        ramp_s = self.ramp_minutes * 60.0
        if t_seconds >= ramp_s:
            return self.peak_discharge_cumecs
        return self.peak_discharge_cumecs * (t_seconds / ramp_s)


@dataclass
class SolverParams:
    manning_n: float = 0.035          # uniform Manning's roughness (assumed; rural/agricultural floodplain)
    cfl: float = 0.4
    dt_max: float = 10.0
    dt_min: float = 0.02
    h_dry: float = 1e-3               # m, wetting/drying threshold
    breach_cell_radius: int = 1       # injects over a (2r+1)x(2r+1) cell block


@dataclass
class SimulationResult:
    times_s: list = field(default_factory=list)
    depth_frames: list = field(default_factory=list)  # list of (rows, cols) float32 arrays
    u_frames: list = field(default_factory=list)      # list of u velocity float32 arrays
    v_frames: list = field(default_factory=list)      # list of v velocity float32 arrays
    max_depth: np.ndarray = None
    n_steps: int = 0
    unstable: bool = False
    injected_volume_m3: float = 0.0


def _breach_mask(rows: int, cols: int, breach: BreachSource, r: int) -> tuple[np.ndarray, int]:
    mask = np.zeros((rows, cols), dtype=bool)
    r0, r1 = max(0, breach.row - r), min(rows, breach.row + r + 1)
    c0, c1 = max(0, breach.col - r), min(cols, breach.col + r + 1)
    mask[r0:r1, c0:c1] = True
    return mask, int(mask.sum())


def run_swe(
    elevation: np.ndarray,
    dx: float,
    dy: float,
    breach: BreachSource,
    duration_s: float,
    snapshot_interval_s: float,
    params: SolverParams = SolverParams(),
) -> SimulationResult:
    rows, cols = elevation.shape
    z = elevation.astype(np.float64)

    h = np.zeros((rows, cols), dtype=np.float64)
    hu = np.zeros((rows, cols), dtype=np.float64)
    hv = np.zeros((rows, cols), dtype=np.float64)

    dzdx = np.zeros_like(z)
    dzdy = np.zeros_like(z)
    dzdx[:, 1:-1] = (z[:, 2:] - z[:, :-2]) / (2 * dx)
    dzdy[1:-1, :] = (z[2:, :] - z[:-2, :]) / (2 * dy)

    breach_mask, n_breach_cells = _breach_mask(rows, cols, breach, params.breach_cell_radius)
    cell_area = dx * dy

    result = SimulationResult()
    result.times_s.append(0.0)
    result.depth_frames.append(h.copy().astype(np.float32))
    result.u_frames.append(np.zeros_like(h, dtype=np.float32))
    result.v_frames.append(np.zeros_like(h, dtype=np.float32))

    t = 0.0
    next_snapshot = snapshot_interval_s
    step = 0
    max_depth = np.zeros((rows, cols), dtype=np.float64)

    def fluxes(h_, hu_, hv_):
        h_safe = np.maximum(h_, params.h_dry)
        u_ = np.where(h_ > params.h_dry, hu_ / h_safe, 0.0)
        v_ = np.where(h_ > params.h_dry, hv_ / h_safe, 0.0)
        p = 0.5 * G * h_ ** 2
        Fx = np.stack([hu_, hu_ * u_ + p, hu_ * v_])
        Fy = np.stack([hv_, hu_ * v_, hv_ * v_ + p])
        return Fx, Fy, u_, v_

    while t < duration_s:
        h_safe = np.maximum(h, params.h_dry)
        u = np.where(h > params.h_dry, hu / h_safe, 0.0)
        v = np.where(h > params.h_dry, hv / h_safe, 0.0)
        wave_speed = np.sqrt(G * np.maximum(h, 0.0))
        max_signal = np.max(np.abs(u) + wave_speed) if rows * cols else 0.0
        max_signal = max(max_signal, np.max(np.abs(v) + wave_speed))
        dt = params.cfl * min(dx, dy) / max(max_signal, 1e-6)
        dt = float(np.clip(dt, params.dt_min, params.dt_max))
        if t + dt > duration_s:
            dt = duration_s - t

        Fx, Fy, _, _ = fluxes(h, hu, hv)
        U = np.stack([h, hu, hv])

        U_new = U.copy()
        # Lax-Friedrichs update on interior cells; edges kept via zero-gradient (open) BC after.
        avg = 0.25 * (
            U[:, :-2, 1:-1] + U[:, 2:, 1:-1] + U[:, 1:-1, :-2] + U[:, 1:-1, 2:]
        )
        dFx = (Fx[:, 1:-1, 2:] - Fx[:, 1:-1, :-2]) / (2 * dx)
        dFy = (Fy[:, 2:, 1:-1] - Fy[:, :-2, 1:-1]) / (2 * dy)
        U_new[:, 1:-1, 1:-1] = avg - dt * dFx - dt * dFy

        # open (zero-gradient) boundaries
        U_new[:, 0, :] = U_new[:, 1, :]
        U_new[:, -1, :] = U_new[:, -2, :]
        U_new[:, :, 0] = U_new[:, :, 1]
        U_new[:, :, -1] = U_new[:, :, -2]

        h_new, hu_new, hv_new = U_new[0], U_new[1], U_new[2]

        # bed-slope source term (semi-implicit: uses pre-step h)
        hu_new += dt * (-G * h * dzdx)
        hv_new += dt * (-G * h * dzdy)

        # breach mass source (hydrograph-driven inflow, no added momentum)
        q_t = breach.discharge_at(t)
        if q_t > 0 and n_breach_cells > 0:
            h_new[breach_mask] += (q_t / (n_breach_cells * cell_area)) * dt
            result.injected_volume_m3 += q_t * dt

        h_new = np.maximum(h_new, 0.0)

        # wetting/drying: zero momentum in near-dry cells
        dry = h_new < params.h_dry
        hu_new = np.where(dry, 0.0, hu_new)
        hv_new = np.where(dry, 0.0, hv_new)

        # point-implicit Manning friction
        h_safe_new = np.maximum(h_new, params.h_dry)
        u_new = np.where(~dry, hu_new / h_safe_new, 0.0)
        v_new = np.where(~dry, hv_new / h_safe_new, 0.0)
        speed = np.sqrt(u_new ** 2 + v_new ** 2)
        denom = 1.0 + dt * G * params.manning_n ** 2 * speed / np.power(h_safe_new, 4.0 / 3.0)
        u_new = np.where(~dry, u_new / denom, 0.0)
        v_new = np.where(~dry, v_new / denom, 0.0)
        hu_new = u_new * h_new
        hv_new = v_new * h_new

        if not np.all(np.isfinite(h_new)) or h_new.max() > 1e4:
            result.unstable = True
            break

        h, hu, hv = h_new, hu_new, hv_new
        t += dt
        step += 1
        max_depth = np.maximum(max_depth, h)

        if t >= next_snapshot or t >= duration_s:
            result.times_s.append(t)
            result.depth_frames.append(h.copy().astype(np.float32))
            
            h_safe_export = np.maximum(h, params.h_dry)
            u_export = np.where(h > params.h_dry, hu / h_safe_export, 0.0).astype(np.float32)
            v_export = np.where(h > params.h_dry, hv / h_safe_export, 0.0).astype(np.float32)
            result.u_frames.append(u_export)
            result.v_frames.append(v_export)
            
            next_snapshot += snapshot_interval_s

    result.n_steps = step
    result.max_depth = max_depth.astype(np.float32)
    return result
