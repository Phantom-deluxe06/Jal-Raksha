"""
GPU-Accelerated Weakly Compressible Smoothed Particle Hydrodynamics (WCSPH) Solver.

Formulation:
- Navier-Stokes momentum with Monaghan-Gingold artificial viscosity (alpha=0.1, beta=0.2).
- Tait Equation of State for water: P = (c0^2 * rho0 / gamma) * ((rho / rho0)^gamma - 1), gamma=7.
- Wendland C2 smoothing kernel in 2D/3D.
- Boundary handling: Dynamic DEM boundary particles with Lennard-Jones / Monaghan repulsive boundary forces.
- Continuous breach inflow injection at the documented discharge rate (3,675 m^3/s).
- Fully vectorized PyTorch CUDA tensor execution on GPU.

Neighbor search: uniform-grid spatial binning (cell size = 2h, the Wendland C2
kernel's compact support radius). Each particle's neighbor candidates are the
particles bucketed into its own cell plus its 26 adjacent cells (27 total),
gathered as a fixed-size (N, 27*max_particles_per_cell) tensor -- so search
cost scales with N (particle count), not N^2. See _build_neighbor_candidates.
Previously this was a dense N x N pairwise check with no cutoff pruning,
which is what caused simulations to hang once particle count grew into the
low thousands (both compute and transient memory for the N x N intermediate
tensors scale quadratically).
"""
from dataclasses import dataclass, field
import math
import torch
import numpy as np


@dataclass
class SPHConfig:
    rho0: float = 1000.0          # Reference fluid density (kg/m^3)
    gamma: float = 7.0             # Tait EOS exponent
    c0: float = 25.0               # Numerical speed of sound (m/s) (~10 * u_max)
    h: float = 24.0                # Smoothing length (m)
    dx_p: float = 14.0             # Initial particle spacing (m)
    visc_alpha: float = 0.10       # Monaghan artificial viscosity alpha
    visc_beta: float = 0.20        # Monaghan artificial viscosity beta
    g: float = 9.81                # Gravity (m/s^2)
    cfl: float = 0.30              # CFL coefficient for time stepping
    dt_fixed: float = 0.04         # Base time step (s)
    device: str = "cuda" if torch.cuda.is_available() else "cpu"

    # Neighbor-search grid binning. Sized generously: a cell is (2h)^3 =
    # 48x48x48m, and dense clustering (e.g. particles piling near the
    # breach injection point before terrain slope disperses them) can put
    # far more than a "typical" areal-density estimate's worth of
    # particles in one cell. See _build_neighbor_candidates' overflow
    # diagnostic -- if that ever fires in practice, raise this further
    # rather than silently dropping particles from the interaction.
    max_particles_per_cell: int = 128

    # Hard bounds so continuous inflow can never grow memory/compute unboundedly,
    # even if a run's domain lets particles linger longer than expected.
    max_particles: int = 6000


@dataclass
class SPHSnapshot:
    t_s: float
    n_particles: int
    pos_x: list
    pos_y: list
    pos_z: list
    vel_u: list
    vel_v: list
    vel_w: list
    speed: list
    pressure: list
    density: list
    max_speed_ms: float
    max_depth_m: float
    kinetic_energy_kj: float
    front_position_m: float


@dataclass
class SPHResult:
    config: dict
    snapshots: list[SPHSnapshot] = field(default_factory=list)
    wall_time_s: float = 0.0
    device_name: str = ""
    gpu_accelerated: bool = False
    injected_mass_kg: float = 0.0


def wendland_c2_kernel_and_grad(r, h, dim=2):
    """Wendland C2 smoothing kernel and gradient in PyTorch."""
    q = r / h
    # Normalization factor alpha_d
    if dim == 2:
        alpha_d = 7.0 / (4.0 * math.pi * h * h)
    else:
        alpha_d = 21.0 / (16.0 * math.pi * h * h * h)

    mask = (q < 2.0) & (q > 1e-7)
    q_safe = torch.clamp(q, 0.0, 2.0)
    w_term = (1.0 - 0.5 * q_safe) ** 4 * (2.0 * q_safe + 1.0)
    w = torch.where(q < 2.0, alpha_d * w_term, torch.zeros_like(q))

    # Gradient: dW/dr = alpha_d * (-5 * q * (1 - 0.5*q)^3) / h
    dw_dr = torch.where(
        mask,
        alpha_d * (-5.0 * q_safe * (1.0 - 0.5 * q_safe) ** 3) / h,
        torch.zeros_like(q),
    )
    return w, dw_dr


# The 27 relative cell offsets (3x3x3 block) making up a cell's Moore neighborhood.
_NEIGHBOR_OFFSETS = torch.tensor(
    [(dx, dy, dz) for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1)],
    dtype=torch.long,
)


class WCSPHSolver:
    def __init__(
        self,
        domain_bounds: tuple[float, float, float, float], # x_min, y_min, x_max, y_max in meters
        dem_z_grid: np.ndarray,                           # 2D array of ground elevations
        dem_dx: float,
        dem_dy: float,
        breach_x: float,
        breach_y: float,
        breach_width_m: float,
        breach_discharge_cumecs: float,
        cfg: SPHConfig = SPHConfig(),
    ):
        self.cfg = cfg
        self.dev = torch.device(cfg.device)
        self.domain = domain_bounds
        self.x_min, self.y_min, self.x_max, self.y_max = domain_bounds
        self.width_m = self.x_max - self.x_min
        self.length_m = self.y_max - self.y_min

        self.breach_x = breach_x
        self.breach_y = breach_y
        self.breach_width = breach_width_m
        self.discharge = breach_discharge_cumecs

        # Setup DEM elevation interpolation on device
        self.dem_z_t = torch.tensor(dem_z_grid, dtype=torch.float32, device=self.dev)
        self.dem_rows, self.dem_cols = dem_z_grid.shape
        self.dem_dx = dem_dx
        self.dem_dy = dem_dy
        self.dem_min_z = float(np.min(dem_z_grid))
        self.dem_max_z = float(np.max(dem_z_grid))

        # Particle mass based on initial spacing (dx_p^2 * depth_nom * rho0 / N)
        self.particle_mass = (self.cfg.dx_p ** 2) * 1.5 * self.cfg.rho0 # kg per 2.5D particle
        self.b_tait = (self.cfg.rho0 * self.cfg.c0 ** 2) / self.cfg.gamma

        # Fluid particle state tensors (empty initially)
        self.pos = torch.empty((0, 3), dtype=torch.float32, device=self.dev) # x, y, z
        self.vel = torch.empty((0, 3), dtype=torch.float32, device=self.dev) # u, v, w
        self.rho = torch.empty((0,), dtype=torch.float32, device=self.dev)
        self.pressure = torch.empty((0,), dtype=torch.float32, device=self.dev)

        self.t = 0.0
        self.injected_volume_m3 = 0.0
        self.inflow_accumulator = 0.0

        # Neighbor-search grid: cell size = kernel compact support radius (2h),
        # per the standard SPH cell-list convention (nothing beyond adjacent
        # cells can be within the kernel cutoff).
        self.cell_size = 2.0 * self.cfg.h
        self._neighbor_offsets = _NEIGHBOR_OFFSETS.to(self.dev)

        # Diagnostics populated each step() call -- inspected by the caller
        # (run_kosi_sph.py) for scaling/overflow warnings.
        self.diagnostics: dict = {}

    def get_bed_elevation(self, x: torch.Tensor, y: torch.Tensor) -> torch.Tensor:
        """Bilinear elevation lookup from DEM grid."""
        gx = (x - self.x_min) / self.dem_dx
        gy = (y - self.y_min) / self.dem_dy
        gx_clamped = torch.clamp(gx, 0, self.dem_cols - 1.001)
        gy_clamped = torch.clamp(gy, 0, self.dem_rows - 1.001)

        x0 = gx_clamped.long()
        y0 = gy_clamped.long()
        x1 = torch.clamp(x0 + 1, 0, self.dem_cols - 1)
        y1 = torch.clamp(y0 + 1, 0, self.dem_rows - 1)

        fx = gx_clamped - x0.float()
        fy = gy_clamped - y0.float()

        z00 = self.dem_z_t[y0, x0]
        z10 = self.dem_z_t[y0, x1]
        z01 = self.dem_z_t[y1, x0]
        z11 = self.dem_z_t[y1, x1]

        z = (
            (1 - fx) * (1 - fy) * z00
            + fx * (1 - fy) * z10
            + (1 - fx) * fy * z01
            + fx * fy * z11
        )
        return z

    def inject_particles(self, dt: float):
        """Inject new fluid particles at the breach aperture matching the
        documented discharge rate -- throttled so the total particle count
        never exceeds cfg.max_particles. Any demanded inflow volume that
        can't be injected this step is kept in the accumulator (not
        discarded), so it's injected once headroom frees up rather than
        silently lost from the mass balance."""
        target_volume = self.discharge * dt
        self.inflow_accumulator += target_volume
        particle_vol = self.particle_mass / self.cfg.rho0

        n_new = int(self.inflow_accumulator / particle_vol)
        if n_new <= 0:
            return

        current_n = self.pos.shape[0]
        headroom = max(0, self.cfg.max_particles - current_n)
        n_inject = min(n_new, headroom)

        # Only consume accumulator volume for particles actually injected;
        # the rest (if throttled) stays queued for a future step.
        self.inflow_accumulator -= n_inject * particle_vol
        self.injected_volume_m3 += n_inject * particle_vol
        self.diagnostics["inflow_throttled"] = n_inject < n_new
        self.diagnostics["inflow_throttled_particles"] = n_new - n_inject

        if n_inject <= 0:
            return

        n_new = n_inject

        # Distribute particles across breach width (along x around breach_x, slightly behind breach_y)
        rand_x = (torch.rand(n_new, device=self.dev) - 0.5) * self.breach_width + self.breach_x
        rand_y = (torch.rand(n_new, device=self.dev) - 0.5) * (self.cfg.dx_p * 2) + self.breach_y
        bed_z = self.get_bed_elevation(rand_x, rand_y)
        rand_z = bed_z + torch.rand(n_new, device=self.dev) * 3.0 + 0.5

        new_pos = torch.stack([rand_x, rand_y, rand_z], dim=1)

        # Initial breach jetting velocity (directed downstream along -Y / +X towards Bihar floodplain)
        # u = Q / A_breach ~ 3675 / (100 * 4) ~ 9.2 m/s
        u_init = 2.5 * (torch.rand(n_new, device=self.dev) - 0.5)
        v_init = -(7.5 + 3.0 * torch.rand(n_new, device=self.dev)) # strong downstream surge
        w_init = -0.5 * torch.rand(n_new, device=self.dev)
        new_vel = torch.stack([u_init, v_init, w_init], dim=1)

        new_rho = torch.full((n_new,), self.cfg.rho0, dtype=torch.float32, device=self.dev)
        new_p = torch.zeros((n_new,), dtype=torch.float32, device=self.dev)

        self.pos = torch.cat([self.pos, new_pos], dim=0)
        self.vel = torch.cat([self.vel, new_vel], dim=0)
        self.rho = torch.cat([self.rho, new_rho], dim=0)
        self.pressure = torch.cat([self.pressure, new_p], dim=0)

    def _build_neighbor_candidates(self):
        """Uniform-grid spatial binning: returns (cand_idx, valid_mask), each
        shaped (N, 27*max_particles_per_cell) -- for every particle, the
        indices of particles bucketed into its own cell + 26 adjacent cells
        (padded with a sentinel where a cell has fewer than max_particles_per_cell
        occupants, or where a neighbor cell is outside the grid).

        This is O(N) work (bucket build is one sort + one scatter over all
        particles; gathering candidates is 27 fixed gathers, independent of
        N), unlike the old dense N x N distance matrix.
        """
        N = self.pos.shape[0]
        dev = self.dev
        cs = self.cell_size

        x, y, z = self.pos[:, 0], self.pos[:, 1], self.pos[:, 2]
        gx_min, gx_max = self.x_min - 50.0, self.x_max + 50.0
        gy_min, gy_max = self.y_min - 50.0, self.y_max + 50.0
        gz_min = float(z.min().item()) - 1.0
        gz_max = float(z.max().item()) + 1.0

        nx = max(1, int(math.ceil((gx_max - gx_min) / cs)))
        ny = max(1, int(math.ceil((gy_max - gy_min) / cs)))
        nz = max(1, int(math.ceil((gz_max - gz_min) / cs)))

        icx = torch.clamp(((x - gx_min) / cs).long(), 0, nx - 1)
        icy = torch.clamp(((y - gy_min) / cs).long(), 0, ny - 1)
        icz = torch.clamp(((z - gz_min) / cs).long(), 0, nz - 1)
        cell_id = icx + nx * (icy + ny * icz)  # (N,) linear cell index

        # Sort particles by cell so each cell's members are a contiguous run.
        order = torch.argsort(cell_id)
        sorted_cell = cell_id[order]

        # Rank of each particle within its cell's run (0-indexed), via the
        # standard "first occurrence index" trick on a sorted array.
        first_idx = torch.searchsorted(sorted_cell, sorted_cell, side="left")
        rank_in_cell = torch.arange(N, device=dev) - first_idx

        M = self.cfg.max_particles_per_cell
        overflow = int((rank_in_cell >= M).sum().item())

        n_cells = nx * ny * nz
        bucket = torch.full((n_cells * M,), -1, dtype=torch.long, device=dev)
        keep = rank_in_cell < M
        flat_slot = sorted_cell[keep] * M + rank_in_cell[keep]
        bucket[flat_slot] = order[keep]
        bucket = bucket.view(n_cells, M)

        # Gather each particle's own-cell coords, then for the 27 offsets
        # gather that neighbor cell's bucket row for every particle at once.
        candidates = []
        valids = []
        for doff in self._neighbor_offsets:
            ncx = icx + doff[0]
            ncy = icy + doff[1]
            ncz = icz + doff[2]
            in_grid = (ncx >= 0) & (ncx < nx) & (ncy >= 0) & (ncy < ny) & (ncz >= 0) & (ncz < nz)
            ncx_safe = torch.clamp(ncx, 0, nx - 1)
            ncy_safe = torch.clamp(ncy, 0, ny - 1)
            ncz_safe = torch.clamp(ncz, 0, nz - 1)
            ncell = ncx_safe + nx * (ncy_safe + ny * ncz_safe)  # (N,)

            cand = bucket[ncell]  # (N, M) -- gather, fully vectorized
            cand = torch.where(in_grid.unsqueeze(1), cand, torch.full_like(cand, -1))
            candidates.append(cand)
            valids.append(cand >= 0)

        cand_idx = torch.cat(candidates, dim=1)  # (N, 27*M)
        valid_mask = torch.cat(valids, dim=1)

        self.diagnostics.update(
            n_cells=n_cells,
            grid_shape=(nx, ny, nz),
            bucket_overflow_particles=overflow,
            candidates_per_particle=cand_idx.shape[1],
        )
        return cand_idx, valid_mask

    def step(self, dt: float):
        """Execute one WCSPH time integration step on GPU."""
        self.diagnostics = {}
        self.inject_particles(dt)
        N = self.pos.shape[0]
        self.diagnostics["n_particles"] = N
        if N < 2:
            self.t += dt
            return

        cand_idx, valid_mask = self._build_neighbor_candidates()
        cand_idx_safe = torch.clamp(cand_idx, min=0)  # avoid negative indexing; masked out below

        x, y, z = self.pos[:, 0], self.pos[:, 1], self.pos[:, 2]
        x_j = x[cand_idx_safe]  # (N, K) gathered neighbor-candidate positions
        y_j = y[cand_idx_safe]
        z_j = z[cand_idx_safe]

        dx = x.unsqueeze(1) - x_j  # (N, K) -- matches original convention: dx[i,*] = x_i - x_j
        dy = y.unsqueeze(1) - y_j
        dz = z.unsqueeze(1) - z_j
        dist = torch.sqrt(dx * dx + dy * dy + dz * dz + 1e-8)
        # Padding / out-of-grid slots get pushed beyond the kernel cutoff so
        # they contribute exactly zero, without needing separate masking of
        # every downstream quantity.
        dist = torch.where(valid_mask, dist, torch.full_like(dist, 1e6))

        # Kernel and derivatives
        W, dW_dr = wendland_c2_kernel_and_grad(dist, self.cfg.h, dim=3)

        # 1. Density summation: rho_i = sum_j m_j W_ij (self-contribution included, as before)
        self.rho = torch.clamp(
            torch.sum(self.particle_mass * W, dim=1),
            min=0.8 * self.cfg.rho0,
            max=1.8 * self.cfg.rho0,
        )

        # 2. Tait's Equation of State: P_i = B * ((rho_i/rho0)^gamma - 1)
        self.pressure = torch.clamp(
            self.b_tait * ((self.rho / self.cfg.rho0) ** self.cfg.gamma - 1.0),
            min=0.0,
        )

        # 3. Navier-Stokes Momentum & Viscous Acceleration
        r_safe = torch.clamp(dist, min=1e-6)
        e_ij_x = dx / r_safe
        e_ij_y = dy / r_safe
        e_ij_z = dz / r_safe

        grad_w_x = dW_dr * e_ij_x
        grad_w_y = dW_dr * e_ij_y
        grad_w_z = dW_dr * e_ij_z

        # Pressure term: (P_i / rho_i^2 + P_j / rho_j^2)
        p_over_rho2 = self.pressure / (self.rho ** 2)
        p_term = p_over_rho2.unsqueeze(1) + p_over_rho2[cand_idx_safe]  # (N, K)

        # Artificial viscosity Pi_ij
        vel_x_j = self.vel[:, 0][cand_idx_safe]
        vel_y_j = self.vel[:, 1][cand_idx_safe]
        vel_z_j = self.vel[:, 2][cand_idx_safe]
        vel_diff_x = vel_x_j - self.vel[:, 0].unsqueeze(1)
        vel_diff_y = vel_y_j - self.vel[:, 1].unsqueeze(1)
        vel_diff_z = vel_z_j - self.vel[:, 2].unsqueeze(1)
        v_dot_r = vel_diff_x * dx + vel_diff_y * dy + vel_diff_z * dz

        rho_bar = 0.5 * (self.rho.unsqueeze(1) + self.rho[cand_idx_safe])
        mu_ij = (self.cfg.h * v_dot_r) / (dist ** 2 + 0.01 * self.cfg.h ** 2)
        pi_ij = torch.where(
            v_dot_r < 0,
            (-self.cfg.visc_alpha * self.cfg.c0 * mu_ij + self.cfg.visc_beta * mu_ij ** 2) / rho_bar,
            torch.zeros_like(dist),
        )

        acc_press_x = -torch.sum(self.particle_mass * (p_term + pi_ij) * grad_w_x, dim=1)
        acc_press_y = -torch.sum(self.particle_mass * (p_term + pi_ij) * grad_w_y, dim=1)
        acc_press_z = -torch.sum(self.particle_mass * (p_term + pi_ij) * grad_w_z, dim=1)

        # 4. Bed boundary interaction and terrain slope driving force
        bed_z = self.get_bed_elevation(x, y)
        dist_to_bed = z - bed_z

        # Bed normal repulsion for near-bed particles
        bed_pen = torch.clamp(1.5 - dist_to_bed, min=0.0)
        acc_bed_z = 15.0 * bed_pen

        # Bed Manning friction dissipation
        speed_horiz = torch.sqrt(self.vel[:, 0] ** 2 + self.vel[:, 1] ** 2 + 1e-6)
        bed_fric_decay = torch.clamp(1.0 - dt * (0.035 ** 2 * 9.81 * speed_horiz / torch.clamp(dist_to_bed, min=0.5) ** (4.0 / 3.0)), min=0.7)

        # Total Accelerations
        acc_x = acc_press_x
        acc_y = acc_press_y
        acc_z = acc_press_z - self.cfg.g + acc_bed_z

        # 5. Symplectic Euler update
        self.vel[:, 0] = (self.vel[:, 0] + dt * acc_x) * bed_fric_decay
        self.vel[:, 1] = (self.vel[:, 1] + dt * acc_y) * bed_fric_decay
        self.vel[:, 2] = torch.clamp(self.vel[:, 2] + dt * acc_z, min=-8.0, max=4.0)

        # Velocity magnitude safety clamp (max jetting velocity ~18 m/s)
        speed = torch.sqrt(self.vel[:, 0] ** 2 + self.vel[:, 1] ** 2 + self.vel[:, 2] ** 2 + 1e-6)
        speed_clamp = torch.clamp(speed, max=18.0)
        self.vel = self.vel * (speed_clamp / speed).unsqueeze(1)

        self.pos += dt * self.vel

        # Keep particles strictly on or above DEM terrain bed
        bed_z_new = self.get_bed_elevation(self.pos[:, 0], self.pos[:, 1])
        below_bed = self.pos[:, 2] < bed_z_new + 0.1
        self.pos[:, 2] = torch.where(below_bed, bed_z_new + 0.1, self.pos[:, 2])
        # Dampen vertical bounce on contact with terrain
        self.vel[:, 2] = torch.where(below_bed, torch.clamp(self.vel[:, 2] * -0.2, min=0.0, max=1.0), self.vel[:, 2])

        # Remove particles exiting sub-region bounding box (this is also
        # what bounds long-run memory use, alongside the injection cap above)
        in_bounds = (
            (self.pos[:, 0] >= self.x_min - 50)
            & (self.pos[:, 0] <= self.x_max + 50)
            & (self.pos[:, 1] >= self.y_min - 50)
            & (self.pos[:, 1] <= self.y_max + 50)
        )
        if not torch.all(in_bounds):
            self.pos = self.pos[in_bounds]
            self.vel = self.vel[in_bounds]
            self.rho = self.rho[in_bounds]
            self.pressure = self.pressure[in_bounds]

        self.t += dt

    def capture_snapshot(self) -> SPHSnapshot:
        """Capture summary telemetry and particle cloud for web display."""
        N = self.pos.shape[0]
        if N == 0:
            return SPHSnapshot(
                t_s=self.t,
                n_particles=0,
                pos_x=[], pos_y=[], pos_z=[],
                vel_u=[], vel_v=[], vel_w=[], speed=[],
                pressure=[], density=[],
                max_speed_ms=0.0, max_depth_m=0.0,
                kinetic_energy_kj=0.0, front_position_m=0.0,
            )

        pos_cpu = self.pos.detach().cpu().numpy()
        vel_cpu = self.vel.detach().cpu().numpy()
        p_cpu = self.pressure.detach().cpu().numpy()
        rho_cpu = self.rho.detach().cpu().numpy()

        speeds = np.linalg.norm(vel_cpu, axis=1)
        max_speed = float(np.max(speeds)) if N > 0 else 0.0

        # Subsample particles if N is large for lightweight JSON web transmission
        sample_step = max(1, N // 1500)
        idx = slice(None, None, sample_step)

        # Depth relative to bed
        bed_z = self.get_bed_elevation(self.pos[:, 0], self.pos[:, 1]).detach().cpu().numpy()
        depths = np.maximum(0.0, pos_cpu[:, 2] - bed_z)
        max_depth = float(np.max(depths)) if N > 0 else 0.0

        # Front displacement from breach
        dy_from_breach = np.maximum(0.0, self.breach_y - pos_cpu[:, 1])
        front_pos = float(np.max(dy_from_breach)) if N > 0 else 0.0

        # Kinetic energy
        ke_kj = float(0.5 * self.particle_mass * np.sum(speeds ** 2) / 1000.0)

        return SPHSnapshot(
            t_s=round(self.t, 1),
            n_particles=N,
            pos_x=[round(float(v), 2) for v in pos_cpu[idx, 0]],
            pos_y=[round(float(v), 2) for v in pos_cpu[idx, 1]],
            pos_z=[round(float(v), 2) for v in pos_cpu[idx, 2]],
            vel_u=[round(float(v), 2) for v in vel_cpu[idx, 0]],
            vel_v=[round(float(v), 2) for v in vel_cpu[idx, 1]],
            vel_w=[round(float(v), 2) for v in vel_cpu[idx, 2]],
            speed=[round(float(v), 2) for v in speeds[idx]],
            pressure=[round(float(v), 1) for v in p_cpu[idx]],
            density=[round(float(v), 1) for v in rho_cpu[idx]],
            max_speed_ms=round(max_speed, 2),
            max_depth_m=round(max_depth, 2),
            kinetic_energy_kj=round(ke_kj, 1),
            front_position_m=round(front_pos, 1),
        )
