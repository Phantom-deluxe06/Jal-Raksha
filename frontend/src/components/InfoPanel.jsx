import { exportUrl } from "../api";

export default function InfoPanel({ meta, frame, onRerun, running, onOpenBuilder, jobId = "kosi_actual2008" }) {
  if (!meta) return null;
  const failed = meta.sanity_checks ? meta.sanity_checks.filter((c) => c.pass_ === false) : [];
  const hasImpact = frame && frame.population_at_risk !== undefined;
  const isHistorical = meta.scenario_type === "historical" || meta.scenario_id === "kosi_actual2008";

  return (
    <div className="info-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
        <div>
          <h2>{meta.scenario_label || "Simulation Results"}</h2>
          {(meta.event_type_label || meta.event_type) && (
            <p style={{ margin: "2px 0 4px 0", fontWeight: 600, color: "#4a90ff", fontSize: "13px" }}>
              Scenario: {meta.event_type_label || meta.event_type} — {meta.scenario_label}
            </p>
          )}
          {meta.scenario_description && (
            <p className="subtle" style={{ margin: "4px 0 8px 0" }}>
              {meta.scenario_description}
            </p>
          )}
        </div>
        {onOpenBuilder && (
          <button className="chip-btn" onClick={onOpenBuilder} style={{ whiteSpace: "nowrap" }}>
            ⚙️ Scenario Builder
          </button>
        )}
      </div>

      <p className="subtle">
        Inflow / Discharge: <strong>{Number(meta.discharge_cumecs || 0).toLocaleString()} m³/s</strong>{" "}
        {isHistorical
          ? "(actual documented 2008 flow — not the barrage's 27,000 m³/s design figure)"
          : `(${meta.scenario_type === "controlled_release" ? "Controlled release" : "Custom scenario"})`}
      </p>

      {meta.breach_latlon && (
        <p className="subtle" style={{ fontSize: "12px", marginTop: "2px" }}>
          Site location: <strong>{meta.breach_latlon.lat.toFixed(4)}°N, {meta.breach_latlon.lon.toFixed(4)}°E</strong>
          {meta.breach_elevation_m !== undefined && ` · Bed elevation: ${meta.breach_elevation_m}m MSL`}
          {meta.breach_width_m !== undefined && ` · Width: ${meta.breach_width_m}m`}
        </p>
      )}

      <div className="stat-grid">
        <div><span>AOI area</span><strong>{meta.aoi_area_km2 ? meta.aoi_area_km2.toLocaleString() : "6,222"} km²</strong></div>
        <div><span>Max flooded area</span><strong>{meta.max_flooded_area_km2 ? meta.max_flooded_area_km2.toLocaleString() : "0"} km²</strong></div>
        <div><span>Max depth</span><strong>{meta.max_depth_m || 0} m</strong></div>
        <div><span>Grid resolution</span><strong>{meta.grid ? `${Math.round(meta.grid.dx_m)}m × ${Math.round(meta.grid.dy_m)}m` : "~185m"}</strong></div>
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
        </div>
      )}

      {hasImpact && (
        <details>
          <summary>Impact methodology</summary>
          <p className="subtle impact-methodology">
            Population from WorldPop 2020 (~1km grid, area-averaged against the flood depth grid);
            settlements from OpenStreetMap, point-in-polygon against this timestep's own flood
            extent. See <code>population_impact_methodology</code> in the run metadata for the full
            method and its caveats.
          </p>
        </details>
      )}

      {meta.sanity_checks && (
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
      )}

      {meta.assumptions && (
        <details>
          <summary>Modeling assumptions</summary>
          <ul className="assumptions">
            {meta.assumptions.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </details>
      )}

      <div className="export-row">
        <a href={exportUrl("geojson", jobId)} download>GeoJSON</a>
        <a href={exportUrl("shp", jobId)} download>Shapefile</a>
        <a href={exportUrl("kml", jobId)} download>KML</a>
      </div>

      <button className="rerun-btn" onClick={onRerun} disabled={running}>
        {running ? "Running solver… (~1-2 min)" : `Re-run ${meta.scenario_label || "Simulation"}`}
      </button>
    </div>
  );
}
