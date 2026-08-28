import { useEffect, useState } from "react";
import { fetchScenarioLibrary, runGenericScenario } from "../api";

/**
 * Deliverable (ii): Multi-river Scenario Library.
 * Shows the framework generalizes beyond Kosi. Real fetched DEMs; physical
 * breach parameters that aren't publicly sourced are shown as "⚠️ Parameter
 * required" and block the run — never invented.
 */
const STATUS_ICON = {
  READY: "✅",
  PENDING: "🟡",
  MISSING: "❌",
  PARAM_REQUIRED: "⚠️",
  NOT_STAGED: "◦",
};
const STATUS_LABEL = { NOT_STAGED: "not staged for this AOI" };

export default function ScenarioLibrary({ onLoadScenario, onEnterView }) {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(null);
  const [runError, setRunError] = useState(null);
  const [form, setForm] = useState({}); // entryId -> {discharge, width, ramp, duration}

  useEffect(() => {
    fetchScenarioLibrary()
      .then((d) => setEntries(d.entries))
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="sb-error-box" style={{ margin: 24 }}>Scenario library error: {error}</div>;
  if (!entries) return <div style={{ padding: 24, color: "#888" }}>Loading scenario library…</div>;

  const setField = (id, k, v) => setForm((f) => ({ ...f, [id]: { ...f[id], [k]: v } }));

  const handleLoadValidated = (entry) => {
    onLoadScenario?.(entry.id);
    onEnterView?.("full");
  };

  const handleRun = async (entry) => {
    const fv = form[entry.id] || {};
    if (!fv.discharge || !fv.lat || !fv.lon) {
      setRunError({ id: entry.id, msg: "Discharge, breach lat and breach lon are required — no defaults are invented for this river." });
      return;
    }
    setRunError(null);
    setRunning(entry.id);
    try {
      const res = await runGenericScenario({
        river: entry.river,
        dam: entry.structure,
        scenario_id: entry.id,
        dem_path: `data/dem/${entry.dem_file}`,
        bounds: entry.aoi_bounds,
        event_type: entry.event_type,
        breach_discharge: Number(fv.discharge),
        breach_lat: Number(fv.lat),
        breach_lon: Number(fv.lon),
        breach_width_m: fv.width ? Number(fv.width) : undefined,
        ramp_minutes: fv.ramp ? Number(fv.ramp) : undefined,
        simulation_duration_hours: fv.duration ? Number(fv.duration) : 4,
        discharge_source: "Operator-supplied via Scenario Library",
      });
      onLoadScenario?.(res.job_id);
      onEnterView?.("full");
    } catch (e) {
      setRunError({ id: entry.id, msg: e.message });
    } finally {
      setRunning(null);
    }
  };

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 4 }}>Scenario Library</h1>
      <p style={{ color: "#8aa0b4", marginTop: 0 }}>
        The engine is river/dam-agnostic. Below: one fully-validated historical case and additional
        Indian rivers with real fetched terrain, pending operator-supplied breach hydraulics.
      </p>

      <div style={{ display: "grid", gap: 18, marginTop: 20 }}>
        {entries.map((e) => {
          const bp = e.breach_parameters || {};
          const fv = form[e.id] || {};
          return (
            <div
              key={e.id}
              style={{
                border: e.validated ? "1px solid rgba(46,213,115,0.5)" : "1px solid rgba(255,255,255,0.15)",
                borderRadius: 10,
                padding: 18,
                background: "rgba(255,255,255,0.03)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>
                    {e.river} — {e.structure}
                  </div>
                  <div style={{ color: "#8aa0b4", fontSize: 13 }}>
                    {e.state} · {e.event} · {e.structure_coordinates.lat.toFixed(3)}°N, {e.structure_coordinates.lon.toFixed(3)}°E
                  </div>
                </div>
                <span
                  style={{
                    alignSelf: "flex-start",
                    fontSize: 12,
                    fontWeight: 600,
                    padding: "4px 10px",
                    borderRadius: 12,
                    background: e.validated ? "rgba(46,213,115,0.18)" : "rgba(255,176,32,0.15)",
                    color: e.validated ? "#2ed573" : "#ffb020",
                  }}
                >
                  {e.badge}
                </span>
              </div>

              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", margin: "12px 0", fontSize: 12 }}>
                {Object.entries(e.data_status).map(([k, v]) => (
                  <span key={k} style={{ color: v === "NOT_STAGED" ? "#667" : "#bbb" }}>
                    {STATUS_ICON[v] || "•"} {k}: <strong style={{ color: v === "NOT_STAGED" ? "#889" : "#ddd" }}>{STATUS_LABEL[v] || v}</strong>
                  </span>
                ))}
              </div>

              <div style={{ fontSize: 12, color: "#999", marginBottom: 12 }}>{e.notes}</div>

              {e.validated ? (
                <button className="sb-run-btn" onClick={() => handleLoadValidated(e)}>
                  📂 Load Validated Simulation
                </button>
              ) : (
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 12 }}>
                  <div style={{ fontSize: 12, color: "#8aa0b4", marginBottom: 8, lineHeight: 1.5 }}>
                    <strong style={{ color: "#cfd8e3" }}>Breach hydraulics — operator input:</strong> {bp.source}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
                    <label style={lbl}>Peak discharge (m³/s)
                      <input style={inp} type="number" value={fv.discharge || ""} placeholder="⚠️ required"
                        onChange={(ev) => setField(e.id, "discharge", ev.target.value)} />
                    </label>
                    <label style={lbl}>Breach lat
                      <input style={inp} type="number" value={fv.lat ?? ""} placeholder={String(e.structure_coordinates.lat)}
                        onChange={(ev) => setField(e.id, "lat", ev.target.value)} />
                    </label>
                    <label style={lbl}>Breach lon
                      <input style={inp} type="number" value={fv.lon ?? ""} placeholder={String(e.structure_coordinates.lon)}
                        onChange={(ev) => setField(e.id, "lon", ev.target.value)} />
                    </label>
                    <label style={lbl}>Breach width (m)
                      <input style={inp} type="number" value={fv.width || ""} placeholder="optional"
                        onChange={(ev) => setField(e.id, "width", ev.target.value)} />
                    </label>
                    <label style={lbl}>Ramp (min)
                      <input style={inp} type="number" value={fv.ramp || ""} placeholder="optional"
                        onChange={(ev) => setField(e.id, "ramp", ev.target.value)} />
                    </label>
                    <label style={lbl}>Duration (h)
                      <input style={inp} type="number" value={fv.duration || ""} placeholder="4"
                        onChange={(ev) => setField(e.id, "duration", ev.target.value)} />
                    </label>
                  </div>
                  <button
                    className="sb-run-btn"
                    style={{ marginTop: 12 }}
                    disabled={running === e.id}
                    onClick={() => handleRun(e)}
                  >
                    {running === e.id ? "Running SWE solver…" : "🚀 Run Simulation"}
                  </button>
                  {runError && runError.id === e.id && (
                    <div className="sb-error-box" style={{ marginTop: 10 }}>{runError.msg}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const lbl = { display: "flex", flexDirection: "column", fontSize: 11, color: "#8aa0b4", gap: 4 };
const inp = {
  background: "rgba(0,0,0,0.4)",
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 4,
  color: "#fff",
  padding: "6px 8px",
  fontSize: 13,
};
