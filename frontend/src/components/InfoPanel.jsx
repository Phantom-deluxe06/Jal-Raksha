import { exportUrl } from "../api";

export default function InfoPanel({ meta, frame, onRerun, running }) {
  if (!meta) return null;
  const failed = meta.sanity_checks.filter((c) => c.pass_ === false);
  const hasImpact = frame && frame.population_at_risk !== undefined;

  return (
    <div className="info-panel">
      <h2>{meta.scenario_label}</h2>
      <p className="subtle">
        Breach discharge: <strong>{meta.discharge_cumecs} m³/s</strong> (actual documented 2008 flow —
        not the barrage's {meta.design_discharge_cumecs_NOT_USED} m³/s design figure)
      </p>

      <div className="stat-grid">
        <div><span>AOI area</span><strong>{meta.aoi_area_km2.toLocaleString()} km²</strong></div>
        <div><span>Max flooded area</span><strong>{meta.max_flooded_area_km2.toLocaleString()} km²</strong></div>
        <div><span>Max depth</span><strong>{meta.max_depth_m} m</strong></div>
        <div><span>Grid resolution</span><strong>{Math.round(meta.grid.dx_m)}m × {Math.round(meta.grid.dy_m)}m</strong></div>
      </div>

      {hasImpact && (
        <div className="impact-block">
          <h3>Impact at T+{frame.t_minutes}min</h3>
          <div className="stat-grid">
            <div><span>Flooded area</span><strong>{frame.flooded_area_km2.toLocaleString()} km²</strong></div>
            <div><span>Est. population at risk (&gt;0.1m)</span><strong>{frame.population_at_risk.toLocaleString()}</strong></div>
            <div><span>Significantly affected (&gt;0.3m)</span><strong>{frame["population_significantly_affected_gt0.3m"].toLocaleString()}</strong></div>
            <div><span>Settlements in extent</span><strong>{frame.affected_settlements_count}</strong></div>
          </div>
          {frame.affected_settlements_count > 0 ? (
            <div className="settlement-chips">
              {frame.affected_settlements.map((s) => (
                <span key={s.name} className="settlement-chip" title={s.place_type}>{s.name}</span>
              ))}
            </div>
          ) : (
            <p className="subtle">No named settlement points fall within the flooded extent at this timestep.</p>
          )}
          <p className="subtle impact-methodology">
            Population from WorldPop 2020 (~1km grid, area-averaged against the flood depth grid);
            settlements from OpenStreetMap, point-in-polygon against this timestep's own flood
            extent. See <code>population_impact_methodology</code> in the run metadata for the full
            method and its caveats (mean-depth thresholding near flood edges, settlement points vs.
            footprints).
          </p>
        </div>
      )}

      <details open={failed.length > 0}>
        <summary className={failed.length ? "warn" : ""}>
          Sanity checks {failed.length ? `— ${failed.length} FLAGGED` : "— all passed"}
        </summary>
        <ul className="checks">
          {meta.sanity_checks.map((c) => (
            <li key={c.name} className={c.pass_ === false ? "warn" : c.pass_ === null ? "context" : "ok"}>
              <strong>{c.name}</strong>: {c.detail}
            </li>
          ))}
        </ul>
      </details>

      <details>
        <summary>Modeling assumptions</summary>
        <ul className="assumptions">
          {meta.assumptions.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      </details>

      <div className="export-row">
        <a href={exportUrl("geojson")}>GeoJSON</a>
        <a href={exportUrl("shp")}>Shapefile</a>
        <a href={exportUrl("kml")}>KML</a>
      </div>

      <button className="rerun-btn" onClick={onRerun} disabled={running}>
        {running ? "Running solver… (~2 min)" : "Re-run simulation"}
      </button>
    </div>
  );
}
