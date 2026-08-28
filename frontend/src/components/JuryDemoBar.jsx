import { useState } from "react";
import { fetchResult } from "../api";
import { JURY_PRESETS } from "../utils/juryPresets";

/**
 * 1-click jury benchmark demo switcher (Track B / Deliverable v).
 * Persistent top bar with 4 open-source Indian river/dam benchmark presets.
 */
export default function JuryDemoBar({ activeJobId, onSelectPreset }) {
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);

  const pick = async (preset) => {
    setBusy(preset.id);
    setNote(null);
    try {
      // Confirm the pre-cached scenario bundle (DEM + frames + impact) is available.
      const meta = await fetchResult(preset.id);
      onSelectPreset({ preset, meta });
      setNote(null);
    } catch (e) {
      setNote(
        `${preset.label}: pre-cached bundle not staged on this backend yet ` +
          `(run the scenario once to cache DEM + frames). ${e.message}`
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={S.bar}>
      <span style={S.brand}>⚡ JURY DEMO</span>
      <div style={S.presets}>
        {JURY_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => pick(p)}
            disabled={busy === p.id}
            style={{
              ...S.chip,
              ...(activeJobId === p.id ? S.chipActive : {}),
              opacity: busy === p.id ? 0.6 : 1,
            }}
            title={`${p.region} — ${p.lat}°N, ${p.lon}°E`}
          >
            <span style={S.chipLabel}>{busy === p.id ? "Loading…" : p.label}</span>
            <span style={S.chipRegion}>{p.region}</span>
          </button>
        ))}
      </div>
      {note && <span style={S.note}>{note}</span>}
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
    lineHeight: 1.25,
  },
  chipActive: { background: "rgba(74,144,255,0.2)", borderColor: "#4a90ff", color: "#fff" },
  chipLabel: { fontSize: 12, fontWeight: 600 },
  chipRegion: { fontSize: 9, color: "#8aa0b4" },
  note: { fontSize: 11, color: "#ffb020", maxWidth: 460 },
};
