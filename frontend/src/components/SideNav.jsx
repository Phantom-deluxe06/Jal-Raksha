import {
  IconHome,
  IconSliders,
  IconWaves,
  IconBuilding,
  IconBolt,
  IconAtom,
  IconGauge,
  IconSatellite,
} from "./icons";

const ITEMS = [
  { id: "overview", label: "Overview", Icon: IconHome },
  { id: "builder", label: "Scenario Builder", Icon: IconSliders, accent: "builder" },
  { id: "full", label: "Full SWE Sim", Icon: IconWaves },
  { id: "impact", label: "Impact Analysis", Icon: IconBuilding, accent: "impact" },
  { id: "instant", label: "Instant AI", Icon: IconBolt },
  { id: "sph", label: "SPH Compare", Icon: IconAtom },
  { id: "twin", label: "Live Twin", Icon: IconGauge },
  { id: "realtime", label: "Real-Time SAR", Icon: IconSatellite, accent: "sar" },
];

export default function SideNav({ mode, setMode }) {
  return (
    <nav className="side-nav">
      <button className="side-nav-brand" onClick={() => setMode("overview")}>
        <span className="brand-mark">FS</span>
        <span className="brand-text">
          <strong>FloodSim</strong>
          <em>HADR · Scenario System</em>
        </span>
      </button>

      <div className="side-nav-items">
        {ITEMS.map(({ id, label, Icon, accent }) => (
          <button
            key={id}
            className={`side-nav-item${mode === id ? " active" : ""}${accent ? ` accent-${accent}` : ""}`}
            onClick={() => setMode(id)}
          >
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="side-nav-footer">
        <span className="live-dot" />
        Real spatial data & physics
      </div>
    </nav>
  );
}
