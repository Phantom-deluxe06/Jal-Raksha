import {
  IconSliders,
  IconWaves,
  IconBuilding,
  IconBolt,
  IconAtom,
  IconGauge,
  IconSatellite,
  IconArrowRight,
} from "./icons";

const MODULES = [
  {
    id: "builder",
    Icon: IconSliders,
    title: "Scenario Builder",
    desc: "Parameterize dam breaches, controlled spillway releases, hydrograph inflows, and duration across the Kosi River domain.",
    accent: "builder",
  },
  {
    id: "full",
    Icon: IconWaves,
    title: "Full SWE Simulation",
    desc: "From-scratch 2D shallow-water solver seeded with the actual documented 2008 breach discharge or custom scenario parameters.",
  },
  {
    id: "impact",
    Icon: IconBuilding,
    title: "Impact Analysis Engine",
    desc: "Zonal exposure analysis across 363 OSM settlements & WorldPop India raster with arrival times and hazard thresholding.",
    accent: "impact",
  },
  {
    id: "instant",
    Icon: IconBolt,
    title: "Instant AI Prediction",
    desc: "A U-Net surrogate trained on 60 real solver runs — sub-second flood prediction for any discharge/location you choose.",
  },
  {
    id: "sph",
    Icon: IconAtom,
    title: "SPH Comparison",
    desc: "A particle-based physics model of the breach zone, cross-checked against the SWE model to show where each approximation breaks down.",
  },
  {
    id: "twin",
    Icon: IconGauge,
    title: "Live Twin",
    desc: "Synced against the real Central Water Commission gauge at Kosi Barrage — an actual live reading, not a simulated one.",
  },
  {
    id: "realtime",
    Icon: IconSatellite,
    title: "Real-Time SAR",
    desc: "The genuine most recent Sentinel-1 radar scene over the AOI, queried live from Google Earth Engine — an observation, not a model.",
    accent: "sar",
  },
];

export default function Overview({ meta, onEnter }) {
  return (
    <div className="overview">
      <div className="overview-hero">
        <span className="overview-eyebrow">SIH26161 · Disaster Response & Scenario Modeling</span>
        <h1>
          Physical Flood Simulation & <em>Scenario Intelligence</em> for the Kosi River Basin
        </h1>
        <p className="overview-lede">
          FloodSim-HADR combines a parameterizable 2D Shallow Water Equations solver, a trained AI surrogate,
          particle-dynamics verification, live Central Water Commission gauge telemetry, and real-time Sentinel-1 SAR
          satellite observation. Test historical validation cases or build custom breach scenarios on real topography.
        </p>
        <div className="overview-cta-row">
          <button className="overview-cta" onClick={() => onEnter("builder")}>
            Open Scenario Builder <IconArrowRight />
          </button>
          <button className="overview-cta secondary" onClick={() => onEnter("impact")}>
            View Impact Analysis
          </button>
          <button className="overview-cta secondary" onClick={() => onEnter("full")}>
            View 2D/3D Simulation
          </button>
        </div>
      </div>

      {meta && (
        <div className="overview-stats">
          <div className="overview-stat">
            <span>Active Scenario</span>
            <strong>{meta.scenario_label || "Kosi 2008 Actual Breach"}</strong>
          </div>
          <div className="overview-stat">
            <span>Modeled Discharge</span>
            <strong>{meta.discharge_cumecs ? meta.discharge_cumecs.toLocaleString() : "3,675"} m³/s</strong>
          </div>
          <div className="overview-stat">
            <span>Simulated Max Flood</span>
            <strong>{meta.max_flooded_area_km2 ? meta.max_flooded_area_km2.toLocaleString() : "116.9"} km²</strong>
          </div>
          <div className="overview-stat">
            <span>Peak Depth</span>
            <strong>{meta.max_depth_m || "2.13"} m</strong>
          </div>
        </div>
      )}

      <div className="overview-grid">
        {MODULES.map(({ id, Icon, title, desc, accent }) => (
          <button
            key={id}
            className={`overview-card${accent ? ` accent-${accent}` : ""}`}
            onClick={() => onEnter(id)}
          >
            <div className="overview-card-icon"><Icon /></div>
            <h3>{title}</h3>
            <p>{desc}</p>
            <span className="overview-card-link">Open <IconArrowRight /></span>
          </button>
        ))}
      </div>
    </div>
  );
}
