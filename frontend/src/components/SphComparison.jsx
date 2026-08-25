import { useEffect, useState } from "react";
import { fetchSphResult } from "../api";

function StatusBadge({ status }) {
  if (status.aborted) {
    return <span className="sph-status-badge warn">ABORTED: {status.abort_reason}</span>;
  }
  return <span className="sph-status-badge ok">Completed, no scaling/timeout issues</span>;
}

export default function SphComparison() {
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchSphResult().then(setMeta).catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="sph-panel">
        <p className="warn">{error}</p>
        <p className="subtle">Run <code>backend/sph/run_kosi_sph.py</code> to generate SPH results.</p>
      </div>
    );
  }
  if (!meta) return <div className="sph-panel"><div className="panel-loading"><span className="spinner" />Loading SPH results…</div></div>;

  const { hardware, neighbor_search, solver_status, domain, parameters, validation_comparison } = meta;
  const timeline = validation_comparison.timelines;
  const maxFront = Math.max(...timeline.map((r) => Math.max(r.sph_front_m, r.swe_front_m)), 1);
  const maxSpeed = Math.max(...timeline.map((r) => Math.max(r.sph_max_speed_ms, r.swe_max_speed_ms)), 1);

  return (
    <div className="sph-panel">
      <h2>SPH vs SWE — Kusaha Breach Zone</h2>
      <p className="subtle">
        {domain.description} · {parameters.discharge_cumecs} m³/s · {parameters.duration_s}s window
      </p>

      <StatusBadge status={solver_status} />

      <div className="stat-grid">
        <div><span>Peak particles</span><strong>{hardware.peak_particles.toLocaleString()}</strong></div>
        <div><span>Wall time</span><strong>{hardware.wall_time_s.toFixed(0)}s</strong></div>
        <div><span>Mean step time</span><strong>{hardware.mean_step_ms.toFixed(1)}ms</strong></div>
        <div><span>Max step time</span><strong>{hardware.max_step_ms.toFixed(1)}ms</strong></div>
      </div>

      <details>
        <summary>Neighbor search (why this used to hang)</summary>
        <p className="subtle">{neighbor_search.note}</p>
        <ul className="assumptions">
          <li>Method: {neighbor_search.method}, cell size {neighbor_search.cell_size_m}m</li>
          <li>Bucket capacity: {neighbor_search.max_particles_per_cell} particles/cell</li>
          <li>Hard particle cap: {neighbor_search.max_particles_cap.toLocaleString()}</li>
        </ul>
      </details>

      <h3>Front position over time</h3>
      <div className="sph-chart">
        {timeline.map((r) => (
          <div key={r.t_s} className="sph-chart-row">
            <span className="sph-chart-t">T+{r.t_s.toFixed(0)}s</span>
            <div className="sph-bar-track">
              <div className="sph-bar sph-bar-swe" style={{ width: `${(r.swe_front_m / maxFront) * 100}%` }} />
              <div className="sph-bar sph-bar-sph" style={{ width: `${(r.sph_front_m / maxFront) * 100}%` }} />
            </div>
            <span className="sph-chart-vals">{r.sph_front_m.toFixed(0)}m / {r.swe_front_m.toFixed(0)}m</span>
          </div>
        ))}
      </div>
      <div className="sph-legend-inline">
        <span><i className="sph-swatch sph-bar-sph" /> SPH front</span>
        <span><i className="sph-swatch sph-bar-swe" /> SWE front (analytic estimate)</span>
      </div>

      <h3>Peak velocity over time</h3>
      <div className="sph-chart">
        {timeline.map((r) => (
          <div key={r.t_s} className="sph-chart-row">
            <span className="sph-chart-t">T+{r.t_s.toFixed(0)}s</span>
            <div className="sph-bar-track">
              <div className="sph-bar sph-bar-swe" style={{ width: `${(r.swe_max_speed_ms / maxSpeed) * 100}%` }} />
              <div className="sph-bar sph-bar-sph" style={{ width: `${(r.sph_max_speed_ms / maxSpeed) * 100}%` }} />
            </div>
            <span className="sph-chart-vals">{r.sph_max_speed_ms.toFixed(1)} / {r.swe_max_speed_ms.toFixed(1)} m/s</span>
          </div>
        ))}
      </div>

      <h3>Divergence table</h3>
      <div className="sph-table-wrap">
        <table className="sph-table">
          <thead>
            <tr><th>T+s</th><th>N</th><th>SPH depth</th><th>SWE depth</th><th>Vel Δ%</th></tr>
          </thead>
          <tbody>
            {timeline.map((r) => (
              <tr key={r.t_s}>
                <td>{r.t_s.toFixed(0)}</td>
                <td>{r.sph_particles.toLocaleString()}</td>
                <td>{r.sph_max_depth_m.toFixed(2)}m</td>
                <td>{r.swe_breach_depth_m.toFixed(2)}m</td>
                <td className={Math.abs(r.velocity_divergence_pct) > 50 ? "warn" : ""}>{r.velocity_divergence_pct.toFixed(0)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details>
        <summary>Why SPH and SWE disagree</summary>
        {validation_comparison.discrepancy_analysis.map((d) => (
          <div key={d.aspect} className="sph-discrepancy-card">
            <strong>{d.aspect}</strong>
            <p className="subtle">SPH: {d.sph_behavior}</p>
            <p className="subtle">SWE: {d.swe_behavior}</p>
            <p className="subtle"><em>{d.physical_reason}</em></p>
          </div>
        ))}
      </details>

      <details>
        <summary>Modeling assumptions</summary>
        <ul className="assumptions">
          {meta.assumptions.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      </details>
    </div>
  );
}
