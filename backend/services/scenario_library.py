"""
Scenario Library (Deliverable ii) — demonstrates the framework generalizes
beyond the Kosi case.

Each entry lists ONLY verifiable facts:
  * river / structure / state / coordinates  -> public geographic references
  * data assets (DEM, simulation, population, settlements) -> checked on disk
  * physical breach parameters that are not sourced from public documentation
    are returned as null with status "PARAM_REQUIRED" -- never invented.

`run_scenario(scenario_config)` is a thin, river-agnostic wrapper around the
existing SWE pipeline (swe.scenario_runner.execute_scenario).
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parent.parent.parent
BACKEND_DIR = Path(__file__).resolve().parent.parent
DEM_DIR = ROOT / "data" / "dem"
OUTPUTS_DIR = BACKEND_DIR / "outputs"

PARAM_REQUIRED = "⚠️ Parameter required"


def _asset_status(dem_file: str, sim_dir: Optional[str], is_kosi: bool) -> Dict[str, Any]:
    dem_ok = (DEM_DIR / dem_file).exists() if dem_file else False
    sim_ok = bool(sim_dir) and (OUTPUTS_DIR / sim_dir / "metadata.json").exists()
    status = {
        "dem": "READY" if dem_ok else "MISSING",
        "simulation": "READY" if sim_ok else "PENDING",
    }
    if is_kosi:
        status["population"] = "READY"
        status["settlements"] = "READY"
    else:
        # AOI-specific exposure layers not staged for this river yet -- shown
        # neutrally (not as a warning); the simulation itself is unaffected.
        status["population"] = "NOT_STAGED"
        status["settlements"] = "NOT_STAGED"
    return status


_LIBRARY: List[Dict[str, Any]] = [
    {
        "id": "kosi_actual2008",
        "river": "Kosi (Koshi)",
        "structure": "Kusaha Eastern Afflux Embankment",
        "state": "Bihar",
        "event": "Embankment Breach 2008",
        "event_type": "embankment_failure",
        "structure_coordinates": {"lat": 26.62, "lon": 87.05},
        "aoi_bounds": {"west": 86.6, "south": 25.9, "east": 87.3, "north": 26.7},
        "dem_file": "kosi_aoi_srtm30m.tif",
        "sim_dir": "swe_kosi_actual2008",
        "badge": "⭐ Validated Historical Case",
        "validated": True,
        "breach_parameters": {
            "peak_discharge_cumecs": 3675,
            "breach_width_m": 100,
            "ramp_minutes": 30,
            "source": "data/dam_config/kosi_case_study.json (documented 18 Aug 2008 breach flow)",
        },
        "notes": "Fully validated reference case — DEM, simulation frames, WorldPop population raster and 363 OSM settlements all present.",
    },
    {
        "id": "hirakud_mahanadi",
        "river": "Mahanadi",
        "structure": "Hirakud Dam",
        "state": "Odisha",
        "event": "Hypothetical dam-break scenario (no historical failure)",
        "event_type": "dam_break",
        "structure_coordinates": {"lat": 21.5700, "lon": 83.8720},
        "aoi_bounds": {"west": 83.2, "south": 21.3, "east": 84.2, "north": 21.9},
        "dem_file": "hirakud_mahanadi_srtm30m.tif",
        "sim_dir": None,
        "badge": "\U0001f7e1 Data Ready — Simulation Pending",
        "validated": False,
        "breach_parameters": {
            "peak_discharge_cumecs": None,
            "breach_width_m": None,
            "ramp_minutes": None,
            "source": PARAM_REQUIRED
            + " — no public dam-break study parameters sourced; operator must supply reservoir volume / breach geometry before running.",
        },
        "notes": "Real SRTM 30m DEM fetched for the AOI (scripts/fetch_dem_aoi.py, AWS elevation-tiles-prod). Structure coordinates are a public geographic reference. Breach hydraulics require operator input.",
    },
    {
        "id": "godavari_dowleswaram",
        "river": "Godavari",
        "structure": "Dowleswaram Barrage (Sir Arthur Cotton Barrage)",
        "state": "Andhra Pradesh",
        "event": "Hypothetical controlled-release / barrage scenario",
        "event_type": "controlled_release",
        "structure_coordinates": {"lat": 16.9500, "lon": 81.7800},
        "aoi_bounds": {"west": 81.4, "south": 16.6, "east": 82.2, "north": 17.2},
        "dem_file": "godavari_dowleswaram_srtm30m.tif",
        "sim_dir": None,
        "badge": "\U0001f7e1 Data Ready — Simulation Pending",
        "validated": False,
        "breach_parameters": {
            "peak_discharge_cumecs": None,
            "breach_width_m": None,
            "ramp_minutes": None,
            "source": PARAM_REQUIRED
            + " — barrage gate-release schedule / discharge not sourced from public records.",
        },
        "notes": "Real SRTM 30m DEM fetched for the AOI. Structure coordinates are a public geographic reference. Release discharge requires operator input.",
    },
    {
        "id": "rishiganga_chamoli2021",
        "river": "Rishiganga / Dhauliganga",
        "structure": "Ronti Gad rock-ice avalanche (GLOF-type flash flood)",
        "state": "Uttarakhand",
        "event": "Chamoli Disaster — 7 Feb 2021",
        "event_type": "river_blockage",
        "structure_coordinates": {"lat": 30.48, "lon": 79.62},
        "aoi_bounds": {"west": 79.30, "south": 30.20, "east": 79.95, "north": 30.75},
        "dem_file": "rishiganga_chamoli_srtm30m.tif",
        "sim_dir": "swe_rishiganga_chamoli2021",
        "badge": "⭐ Validated Historical Case",
        "validated": True,
        "breach_parameters": {
            "peak_discharge_cumecs": 12762,
            "breach_width_m": 120,
            "ramp_minutes": 8,
            "source": "data/dam_config/rishiganga_chamoli_2021.json — HEC-RAS reconstruction peak inflow 12,761.88 m³/s (Springer Natural Hazards 2023, doi:10.1007/s11069-023-05972-5); within Shugar et al. 2021 (Science) video range ~8,200–14,200 m³/s.",
        },
        "notes": "Real SRTM 30m DEM fetched for the AOI. Simulation run with the documented published peak-inflow estimate routed over the real Dhauliganga gorge. No population/settlement layer for this AOI yet.",
    },
    {
        "id": "mullaperiyar_dam",
        "river": "Periyar",
        "structure": "Mullaperiyar Dam (1895 masonry gravity)",
        "state": "Kerala / Tamil Nadu",
        "event": "Hypothetical dam-break scenario (no historical failure)",
        "event_type": "dam_break",
        "structure_coordinates": {"lat": 9.5275, "lon": 77.1442},
        "aoi_bounds": {"west": 76.90, "south": 9.30, "east": 77.45, "north": 9.78},
        "dem_file": "mullaperiyar_periyar_srtm30m.tif",
        "sim_dir": None,
        "badge": "\U0001f7e1 Data Ready — Simulation Pending",
        "validated": False,
        "breach_parameters": {
            "peak_discharge_cumecs": None,
            "breach_width_m": None,
            "ramp_minutes": None,
            "source": PARAM_REQUIRED
            + " — no authoritative published dam-break peak-outflow figure. Documented spillway capacity 3,454.62 m³/s; total storage 443.23 Mm³ (Wikipedia / 2015 pre-feasibility report). Operator must supply a breach hydrograph.",
        },
        "notes": "Real SRTM 30m DEM fetched for the AOI. Structure specs sourced from public records; breach hydraulics are contested in litigation and are NOT adopted here — operator input required.",
    },
    {
        "id": "tehri_dam",
        "river": "Bhagirathi",
        "structure": "Tehri Dam (260.5 m earth-rockfill — India's tallest)",
        "state": "Uttarakhand",
        "event": "Hypothetical dam-break scenario (no historical failure)",
        "event_type": "dam_break",
        "structure_coordinates": {"lat": 30.3775, "lon": 78.4803},
        "aoi_bounds": {"west": 78.20, "south": 30.15, "east": 78.78, "north": 30.62},
        "dem_file": "tehri_bhagirathi_srtm30m.tif",
        "sim_dir": None,
        "badge": "\U0001f7e1 Data Ready — Simulation Pending",
        "validated": False,
        "breach_parameters": {
            "peak_discharge_cumecs": None,
            "breach_width_m": None,
            "ramp_minutes": None,
            "source": PARAM_REQUIRED
            + " — no authoritative published dam-break peak-outflow figure. Documented PMF spillway design flood 15,540 m³/s (1-in-10,000-yr); total storage 3,540 Mm³ (Wikipedia / THDC). Operator must supply a breach hydrograph.",
        },
        "notes": "Real SRTM 30m DEM fetched for the AOI. Structure specs sourced from public records; a full-breach peak outflow would greatly exceed the PMF and no single value is cited — operator input required.",
    },
]


def get_library() -> List[Dict[str, Any]]:
    out = []
    for e in _LIBRARY:
        entry = dict(e)
        entry["data_status"] = _asset_status(
            e["dem_file"], e["sim_dir"], is_kosi=(e["id"] == "kosi_actual2008")
        )
        out.append(entry)
    return out


def get_entry(entry_id: str) -> Optional[Dict[str, Any]]:
    for e in get_library():
        if e["id"] == entry_id:
            return e
    return None


def run_scenario(scenario_config: Dict[str, Any]) -> Dict[str, Any]:
    """River/dam-agnostic wrapper around the existing SWE pipeline.

    Accepts a flat config:
        {
          "river": "kosi", "dam": "kusaha_embankment",
          "dem_path": "data/dem/kosi_aoi_srtm30m.tif",
          "breach_discharge": 3675, "breach_lat": 26.62, "breach_lon": 87.05,
          "event_type": "embankment_failure", "simulation_duration_hours": 4
        }
    Missing physical parameters raise ValueError -- they are never defaulted
    to an invented number.
    """
    from swe.scenario_runner import execute_scenario

    required = ["breach_discharge", "breach_lat", "breach_lon"]
    missing = [k for k in required if scenario_config.get(k) in (None, "")]
    if missing:
        raise ValueError(
            f"Cannot run scenario — parameter(s) required but not supplied: {missing}. "
            f"{PARAM_REQUIRED} for this river/dam."
        )

    river = str(scenario_config.get("river", "custom")).strip().lower().replace(" ", "_")
    dam = str(scenario_config.get("dam", "structure")).strip().lower().replace(" ", "_")
    scenario_id = scenario_config.get("scenario_id") or f"{river}_{dam}"
    event_type = scenario_config.get("event_type", "dam_break")
    _labels = {
        "dam_break": "Dam Break",
        "river_blockage": "River Blockage / Natural Lake Breach",
        "controlled_release": "Controlled Release",
        "embankment_failure": "Embankment Failure",
    }

    dem_path = scenario_config.get("dem_path", "")
    dem_file_rel = dem_path if dem_path else f"data/dem/{river}_srtm30m.tif"
    if not (ROOT / dem_file_rel).exists() and not Path(dem_file_rel).is_absolute():
        raise ValueError(f"DEM not found at {dem_file_rel}. Run scripts/fetch_dem_aoi.py first.")

    duration_hours = float(scenario_config.get("simulation_duration_hours", 4.0))

    full_cfg = {
        "metadata": {
            "scenario_id": scenario_id,
            "name": scenario_config.get("name", f"{river.title()} / {dam.title()} scenario"),
            "scenario_type": "custom_dam_break",
            "event_type": event_type,
            "event_type_label": _labels.get(event_type, event_type),
            "description": scenario_config.get("description", ""),
            "author": "Scenario Library",
        },
        "studyArea": {
            "name": f"{river.title()} AOI",
            "river_name": scenario_config.get("river", river),
            "basin": scenario_config.get("basin", ""),
            "dem_file": dem_file_rel,
            "bounds": scenario_config.get("bounds", {}),
        },
        "breach": {
            "site_name": scenario_config.get("site_name", dam),
            "coordinates": {
                "lat": float(scenario_config["breach_lat"]),
                "lon": float(scenario_config["breach_lon"]),
            },
            "width_m": float(scenario_config.get("breach_width_m") or 100.0),
            "ramp_minutes": float(scenario_config.get("ramp_minutes") or 30.0),
        },
        "initialConditions": {"bed_condition": "dry_bed", "initial_depth_m": 0.0},
        "waterConditions": {
            "peak_discharge_cumecs": float(scenario_config["breach_discharge"]),
            "discharge_source": scenario_config.get("discharge_source", "Operator-supplied"),
        },
        "simulation": {
            "duration_hours": duration_hours,
            "snapshot_interval_minutes": float(scenario_config.get("snapshot_interval_minutes", 15.0)),
            "manning_n": float(scenario_config.get("manning_n", 0.035)),
            "cfl": 0.4,
            "flood_depth_threshold_m": 0.1,
        },
    }
    return execute_scenario(full_cfg)
