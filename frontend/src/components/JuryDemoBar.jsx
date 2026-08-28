import { useEffect, useState } from "react";
import { fetchScenarioLibrary } from "../api";

/**
 * 1-click jury benchmark demo switcher (Deliverable v).
 * Driven entirely by GET /scenarios/library so every chip is either
 *   - Validated (loads immediately), or
 *   - Data ready / simulation pending (opens the Scenario Library cleanly).
 * It never calls a per-scenario result endpoint, so it can never surface a 404.
 */
export default function JuryDemoBar({ activeJobId, onSelectScenario }) {
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchScenarioLibrary()
      .then((d) => setEntries(d.entries || []))
      .catch(() => setError(true));
  }, []);

  if (error || entries.length === 0) return null; // fail silent — bar is a convenience

  return (
    <div style={S.bar}>
      <span style={S.brand}>⚡ JURY DEMO</span>
      <div style={S.presets}>
        {entries.map((e) => {
          const ready = e.data_status?.simulation === "READY";
          return (
            <button
              key={e.id}
              onClick={() => onSelectScenario(e.id, ready)}
              style={{
                ...S.chip,
                ...(activeJobId === e.id ? S.chipActive : {}),
                borderColor: ready ? "rgba(46,213,115,0.5)" : "rgba(255,176,32,0.45)",
              }}
              title={`${e.state} · ${e.structure_coordinates.lat.toFixed(2)}°N, ${e.structure_coordinates.lon.toFixed(2)}°E`}
            >
              <span style={S.chipLabel}>{e.river}</span>
              <span style={{ ...S.chipState, color: ready ? "#2ed573" : "#ffb020" }}>
                {ready ? "● Validated — load" : "● Data ready — pending"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const S = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "8px 14px",
    background: "linear-gradient(90deg, #0a0e14, #12202e)",
    borderBottom: "1px solid rgba(74,144,255,0.35)",
    flexWrap: "wrap",
    zIndex: 50,
  },
  brand: { fontSize: 12, fontWeight: 800, letterSpacing: 1, color: "#4a90ff", whiteSpace: "nowrap" },
  presets: { display: "flex", gap: 8, flexWrap: "wrap" },
  chip: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 6,
    padding: "5px 12px",
    color: "#ddd",
    cursor: "pointer",
    lineHeight: 1.3,
  },
  chipActive: { background: "rgba(74,144,255,0.2)", color: "#fff" },
  chipLabel: { fontSize: 12, fontWeight: 600 },
  chipState: { fontSize: 9 },
};
