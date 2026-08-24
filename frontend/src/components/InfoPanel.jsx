import { exportUrl } from "../api";

export default function InfoPanel({ meta, onRerun, running }) {
  if (!meta) return null;
  const failed = meta.sanity_checks.filter((c) => c.pass_ === false);

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
