import { IconWaves, IconBolt, IconAtom, IconGauge, IconSatellite, IconArrowRight } from "./icons";

const MODULES = [
  {
    id: "full",
    Icon: IconWaves,
    title: "Full SWE Simulation",
    desc: "From-scratch 2D shallow-water solver seeded with the actual documented 2008 breach discharge, not a theoretical design figure.",
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
        <span className="overview-eyebrow">SIH26161 · Disaster Response Case Study</span>
        <h1>
          Modeling the <em>2008 Kusaha breach</em> on the Kosi River — five ways, all on real data.
        </h1>
        <p className="overview-lede">
          FloodSim-HADR reconstructs the embankment failure that displaced millions in Bihar,
          combining a physics-based flood solver, a trained AI surrogate, a particle-dynamics
          cross-check, a live government gauge feed, and real-time satellite observation into one
          platform. Every number you'll see below comes from an actual run, sync, or query — not a
          placeholder.
        </p>
        <div className="overview-cta-row">
          <button className="overview-cta" onClick={() => onEnter("full")}>
            Open the simulation <IconArrowRight />
          </button>
          <span className="overview-cta-hint">or pick a module below</span>
        </div>
      </div>

      {meta && (
        <div className="overview-stats">
          <div className="overview-stat">
            <span>Documented breach discharge</span>
            <strong>{meta.discharge_cumecs.toLocaleString()} m³/s</strong>
          </div>
          <div className="overview-stat">
            <span>Simulated max flood extent</span>
            <strong>{meta.max_flooded_area_km2.toLocaleString()} km²</strong>
          </div>
          <div className="overview-stat">
            <span>Peak modeled depth</span>
            <strong>{meta.max_depth_m} m</strong>
          </div>
          <div className="overview-stat">
            <span>Breach date</span>
            <strong>18 Aug 2008</strong>
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
