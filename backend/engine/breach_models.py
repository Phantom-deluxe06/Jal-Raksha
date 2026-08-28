import math
import numpy as np

def froehlich_peak_discharge(volume_mcm: float, height_m: float) -> float:
    """
    Computes the peak discharge Qp using Froehlich (1995) empirical equation.
    Qp = 0.607 * (Vw^0.295) * (hd^1.24)
    where Vw is volume in million cubic meters, hd is height in meters.
    Result in m^3/s.
    """
    if volume_mcm <= 0 or height_m <= 0:
        return 0.0
    return 0.607 * (volume_mcm ** 0.295) * (height_m ** 1.24)

def generate_breach_hydrograph(
    peak_discharge: float, 
    formation_time_hr: float, 
    total_duration_hr: float, 
    dt_sec: float,
    breach_mode: str = "overtopping"
) -> np.ndarray:
    """
    Generates a discrete time-series inflow hydrograph Q(t).
    For overtopping: Rapid trapezoidal expansion (linear ramp up, exponential/linear decay).
    For piping: Parabolic/exponential ramp up then decay.
    """
    timesteps = int((total_duration_hr * 3600) / dt_sec)
    time_array_sec = np.arange(timesteps) * dt_sec
    Q = np.zeros(timesteps, dtype=np.float32)
    
    t_peak_sec = formation_time_hr * 3600.0
    
    if t_peak_sec <= 0:
        t_peak_sec = dt_sec # Instantaneous
        
    for i, t in enumerate(time_array_sec):
        if t <= t_peak_sec:
            if breach_mode == "piping":
                # Quadratic ramp up for piping (slow start, rapid finish)
                Q[i] = peak_discharge * ((t / t_peak_sec) ** 2)
            else:
                # Linear ramp up for overtopping
                Q[i] = peak_discharge * (t / t_peak_sec)
        else:
            # Exponential decay based on remaining volume
            # We'll use a standard recession limb approach
            decay_const = 2.0 / (total_duration_hr * 3600 - t_peak_sec + 1)
            Q[i] = peak_discharge * math.exp(-decay_const * (t - t_peak_sec))
            
    return Q
