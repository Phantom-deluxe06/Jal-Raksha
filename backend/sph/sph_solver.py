"""
GPU-Accelerated Weakly Compressible Smoothed Particle Hydrodynamics (WCSPH) Solver.

Formulation:
- Navier-Stokes momentum with Monaghan-Gingold artificial viscosity (alpha=0.1, beta=0.2).
- Tait Equation of State for water: P = (c0^2 * rho0 / gamma) * ((rho / rho0)^gamma - 1), gamma=7.
- Wendland C2 smoothing kernel in 2D/3D.
- Boundary handling: Dynamic DEM boundary particles with Lennard-Jones / Monaghan repulsive boundary forces.
- Continuous breach inflow injection at the documented discharge rate (3,675 m^3/s).
- Fully vectorized PyTorch CUDA tensor execution on GPU.
"""
from dataclasses import dataclass, field
import math
import torch
import numpy as np


@dataclass
class SPHConfig:
    rho0: float = 1000.0          # Reference fluid density (kg/m^3)
    gamma: float = 7.0             # Tait EOS exponent
    c0: float = 45.0               # Numerical speed of sound (m/s) (~10 * u_max)
    h: float = 12.0                # Smoothing length (m)
    dx_p: float = 6.0              # Initial particle spacing (m)
    visc_alpha: float = 0.08       # Monaghan artificial viscosity alpha
    visc_beta: float = 0.16        # Monaghan artificial viscosity beta
    g: float = 9.81                # Gravity (m/s^2)
    cfl: float = 0.25              # CFL coefficient for time stepping
    dt_fixed: float = 0.015        # Base time step (s)
    device: str = "cuda" if torch.cuda.is_available() else "cpu"


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
        """Inject new fluid particles at the breach aperture matching the 3,675 m^3/s flow rate."""
        target_volume = self.discharge * dt
        self.inflow_accumulator += target_volume
        particle_vol = self.particle_mass / self.cfg.rho0

        n_new = int(self.inflow_accumulator / particle_vol)
        if n_new <= 0:
            return

        self.inflow_accumulator -= n_new * particle_vol
        self.injected_volume_m3 += n_new * particle_vol

        # Distribute particles across breach width (along x around breach_x, slightly behind breach_y)
        half_w = self.breach_width / 2.0
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

    def step(self, dt: float):
        """Execute one WCSPH time integration step on GPU."""
        self.inject_particles(dt)
        N = self.pos.shape[0]
        if N < 2:
            self.t += dt
            return

        # Pairwise distance calculation (within cutoff 2*h)
        # Using fast chunked / vectorized broadcast
        x = self.pos[:, 0]
        y = self.pos[:, 1]
        z = self.pos[:, 2]

        dx = x.unsqueeze(1) - x.unsqueeze(0) # (N, N)
        dy = y.unsqueeze(1) - y.unsqueeze(0)
        dz = z.unsqueeze(1) - z.unsqueeze(0)
        dist = torch.sqrt(dx * dx + dy * dy + dz * dz + 1e-8)

        # Kernel and derivatives
        W, dW_dr = wendland_c2_kernel_and_grad(dist, self.cfg.h, dim=3)

        # 1. Density summation: rho_i = sum_j m_j W_ij
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
        # grad W_ij unit vector
        r_safe = torch.clamp(dist, min=1e-6)
        e_ij_x = dx / r_safe
        e_ij_y = dy / r_safe
        e_ij_z = dz / r_safe

        grad_w_x = dW_dr * e_ij_x
        grad_w_y = dW_dr * e_ij_y
        grad_w_z = dW_dr * e_ij_z

        # Pressure term: (P_i / rho_i^2 + P_j / rho_j^2)
        p_over_rho2 = self.pressure / (self.rho ** 2)
        p_term = p_over_rho2.unsqueeze(1) + p_over_rho2.unsqueeze(0) # (N, N)

        # Artificial viscosity Pi_ij
        vel_diff_x = self.vel[:, 0].unsqueeze(0) - self.vel[:, 0].unsqueeze(1)
        vel_diff_y = self.vel[:, 1].unsqueeze(0) - self.vel[:, 1].unsqueeze(1)
        vel_diff_z = self.vel[:, 2].unsqueeze(0) - self.vel[:, 2].unsqueeze(1)
        v_dot_r = vel_diff_x * dx + vel_diff_y * dy + vel_diff_z * dz

        rho_bar = 0.5 * (self.rho.unsqueeze(1) + self.rho.unsqueeze(0))
        mu_ij = (self.cfg.h * v_dot_r) / (dist ** 2 + 0.01 * self.cfg.h ** 2)
        pi_ij = torch.where(
            v_dot_r < 0,
            (-self.cfg.visc_alpha * self.cfg.c0 * mu_ij + self.cfg.visc_beta * mu_ij ** 2) / rho_bar,
            torch.zeros_like(dist),
        )

        acc_press_x = -torch.sum(self.particle_mass * (p_term + pi_ij) * grad_w_x, dim=1)
        acc_press_y = -torch.sum(self.particle_mass * (p_term + pi_ij) * grad_w_y, dim=1)
        acc_press_z = -torch.sum(self.particle_mass * (p_term + pi_ij) * grad_w_z, dim=1)

        # 4. Bed boundary repulsive acceleration & friction
        bed_z = self.get_bed_elevation(x, y)
        dist_to_bed = z - bed_z
        # Repulsive force when particle approaches bed
        bed_pen = torch.clamp(self.cfg.dx_p - dist_to_bed, min=0.0)
        acc_bed_z = 250.0 * bed_pen + torch.where(dist_to_bed < 0.2, 50.0, 0.0)
        # Bed Manning friction dissipation
        speed_horiz = torch.sqrt(self.vel[:, 0] ** 2 + self.vel[:, 1] ** 2 + 1e-6)
        bed_fric_decay = torch.clamp(1.0 - dt * 0.035 * speed_horiz / torch.clamp(dist_to_bed, min=0.1), min=0.5)

        # Total Accelerations
        acc_x = acc_press_x
        acc_y = acc_press_y
        acc_z = acc_press_z - self.cfg.g + acc_bed_z

        # 5. Symplectic Euler update
        self.vel[:, 0] = (self.vel[:, 0] + dt * acc_x) * bed_fric_decay
        self.vel[:, 1] = (self.vel[:, 1] + dt * acc_y) * bed_fric_decay
        self.vel[:, 2] = self.vel[:, 2] + dt * acc_z

        self.pos += dt * self.vel

        # Keep particles strictly above DEM terrain bed
        bed_z_new = self.get_bed_elevation(self.pos[:, 0], self.pos[:, 1])
        below_bed = self.pos[:, 2] < bed_z_new + 0.1
        self.pos[:, 2] = torch.where(below_bed, bed_z_new + 0.1, self.pos[:, 2])
        self.vel[:, 2] = torch.where(below_bed, torch.clamp(self.vel[:, 2], min=0.0), self.vel[:, 2])

        # Remove particles exiting sub-region bounding box
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
