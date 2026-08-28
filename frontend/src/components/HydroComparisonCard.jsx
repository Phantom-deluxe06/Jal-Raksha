import { useEffect, useState } from "react";
import { fetchHydroComparison } from "../api";

/**
 * Side-by-side SPH near-field jet vs regional 2D SWE routing card.
 * Track B deliverable: honest dual-hydrodynamic physics disclosure.
 */
const S = {
  card: {
    background: "rgba(10,14,20,0.95)",
    border: "1px solid rgba(77,208,225,0.35)",
    borderRadius: 8,
    padding: 20,
    marginTop: 20,
    color: "#fff",
    fontFamily: "Inter, sans-serif",
  },
  title: { fontSize: 16, fontWeight: 600, marginBottom: 10 },
  badge: {
    display: "inline-block",
    fontSize: 11,
    background: "rgba(77,208,225,0.15)",
    color: "#4dd0e1",
    padding: "3px 8px",
    borderRadius: 10,
    marginBottom: 14,
  },
  cols: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 },
  col: { background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: 14 },
  colLabel: { fontSize: 12, fontWeight: 700, letterSpacing: 0.5, marginBottom: 6 },
  modelName: { fontSize: 12, color: "#ddd", marginBottom: 2 },
  region: { fontSize: 11, color: "#888", marginBottom: 10 },
  metricRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "4px 0",
    borderTop: "1px solid rgba(255,255,255,0.06)",
  },
  metricKey: { fontSize: 12, color: "#999" },
  metricVal: { fontSize: 12, fontWeight: 600, textAlign: "right", maxWidth: "62%" },
  ratios: { display: "flex", gap: 24, justifyContent: "center", margin: "16px 0" },
  ratioVal: { fontSize: 22, fontWeight: 700, textAlign: "center", color: "#4dd0e1" },
  ratioKey: { fontSize: 10, color: "#888", textAlign: "center" },
  disclosure: {
    fontSize: 11,
    lineHeight: 1.5,
    color: "#aaa",
    borderTop: "1px solid rgba(255,255,255,0.1)",
    paddingTop: 10,
    margin: 0,
  },
};

function ModelColumn({ label, model, accent }) {
  return (
    <div style={{ ...S.col, borderTop: `3px solid ${accent}` }}>
      <div style={{ ...S.colLabel, color: accent }}>{label}</div>
      <div style={S.modelName}>{model.solver}</div>
      <div style={S.region}>{model.region}</div>
      <div style={S.metricRow}>
        <span style={S.metricKey}>Velocity</span>
        <span style={S.metricVal}>
          {model.velocity_mps.min}–{model.velocity_mps.max} m/s
        </span>
      </div>
      <div style={S.metricRow}>
        <span style={S.metricKey}>Bed shear τ</span>
        <span style={S.metricVal}>{model.bed_shear_stress_pa} Pa</span>
      </div>
      <div style={S.metricRow}>
        <span style={S.metricKey}>Froude</span>
        <span style={S.metricVal}>
          {model.froude.min}–{model.froude.max}
        </span>
      </div>
      <div style={S.metricRow}>
        <span style={S.metricKey}>Regime</span>
        <span style={{ ...S.metricVal, fontSize: 11, color: "#aaa" }}>{model.flow_regime}</span>
      </div>
    </div>
  );
}

export default function HydroComparisonCard({ jobId }) {
  const [state, setState] = useState({ status: "loading", jobId: null, data: null, error: null });

  useEffect(() => {
    let alive = true;
    fetchHydroComparison(jobId)
      .then((d) => alive && setState({ status: "ready", jobId, data: d, error: null }))
      .catch((e) => alive && setState({ status: "error", jobId, data: null, error: e.message }));
    return () => {
      alive = false;
    };
  }, [jobId]);

  const fresh = state.jobId === jobId;

  if (!fresh || state.status === "loading") {
    return (
      <div style={S.card}>
        <div style={S.title}>SPH vs SWE — Dual Hydrodynamic Benchmark</div>
        <p style={{ color: "#888", fontSize: 13 }}>Loading comparison…</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div style={S.card}>
        <div style={S.title}>SPH vs SWE — Dual Hydrodynamic Benchmark</div>
        <p style={{ color: "#ff9f1c", fontSize: 13 }}>{state.error}</p>
      </div>
    );
  }

  const data = state.data;
  const sph = data.sph_near_field;
  const swe = data.swe_regional;

  return (
    <div style={S.card}>
      <div style={S.title}>SPH vs SWE — Dual Hydrodynamic Benchmark</div>
      <div style={S.badge}>⚖ {data.honest_badge}</div>

      <div style={S.cols}>
        <ModelColumn label="NEAR-FIELD (SPH)" model={sph} accent="#4dd0e1" />
        <ModelColumn label="REGIONAL (2D SWE)" model={swe} accent="#ffb020" />
      </div>

      <div style={S.ratios}>
        <div>
          <div style={S.ratioVal}>{data.peak_velocity_ratio_sph_over_swe}×</div>
          <div style={S.ratioKey}>peak velocity SPH / SWE</div>
        </div>
        <div>
          <div style={S.ratioVal}>{data.shear_stress_ratio_sph_over_swe}×</div>
          <div style={S.ratioKey}>bed shear SPH / SWE</div>
        </div>
      </div>

      <p style={S.disclosure}>{data.physics_disclosure}</p>
    </div>
  );
}
