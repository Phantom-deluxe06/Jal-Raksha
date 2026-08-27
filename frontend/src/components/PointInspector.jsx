import React from "react";

export default function PointInspector({
  pointData,
  loading,
  frameIndex,
  onSelectTimestep,
  onClear,
}) {
  if (loading) {
    return (
      <div className="point-inspector loading">
        <div className="inspector-spinner" />
        <p>Querying SWE simulation grid at selected coordinate…</p>
      </div>
    );
  }

  if (!pointData) return null;

  if (!pointData.in_bounds) {
    return (
      <div className="point-inspector out-of-bounds">
        <div className="inspector-header">
          <div className="inspector-title">
            <span className="inspector-icon">⚠️</span>
            <h3>Location Outside Simulation Domain</h3>
          </div>
          <button className="clear-btn" onClick={onClear} title="Clear point selection">✕</button>
        </div>
        <p className="subtle">
          Clicked coordinate <code>{pointData.lat.toFixed(4)}°N, {pointData.lon.toFixed(4)}°E</code> falls outside the Kosi case study bounding box.
        </p>
      </div>
    );
  }

  const timeseries = pointData.timeseries || [];
  const current = timeseries[frameIndex] || {
    t_minutes: 0,
    depth_m: 0,
    velocity_mps: 0,
    u_mps: 0,
    v_mps: 0,
    is_flooded: false,
  };

  const isFloodedNow = current.depth_m >= (pointData.threshold_m || 0.1);
  const maxDepth = pointData.max_depth_m || 0.001;

  const getDepthColor = (depth) => {
    if (depth < 0.1) return "var(--surface-4)";
    if (depth < 0.5) return "rgb(100, 181, 246)";
    if (depth < 1.5) return "rgb(33, 150, 243)";
    if (depth < 3.0) return "rgb(25, 90, 200)";
    if (depth < 6.0) return "rgb(13, 40, 130)";
    return "rgb(60, 10, 90)";
  };

  return (
    <div className="point-inspector">
      <div className="inspector-header">
        <div className="inspector-title">
          <span className="inspector-icon">📍</span>
          <div>
            <h3>Point Flood Analysis</h3>
            <span className="inspector-coords">
              {pointData.lat.toFixed(4)}°N, {pointData.lon.toFixed(4)}°E &nbsp;•&nbsp; Elev: {pointData.elevation_m}m
            </span>
          </div>
        </div>
        <button className="clear-btn" onClick={onClear} title="Clear point selection">✕</button>
      </div>

      <div className="grid-meta-pill">
        <span>SWE Grid: <strong>Row {pointData.grid_row}, Col {pointData.grid_col}</strong></span>
        <span>Flood Threshold: <strong>≥ {pointData.threshold_m}m</strong></span>
      </div>

      {/* Current Timestep Card */}
      <div className={`timestep-card ${isFloodedNow ? "wet" : "dry"}`}>
        <div className="timestep-card-header">
          <span>Active Timestep: <strong>T+{current.t_minutes} min</strong></span>
          <span className={`status-pill ${isFloodedNow ? "wet" : "dry"}`}>
            {isFloodedNow ? "🌊 Inundated" : "☀️ Dry / Below Threshold"}
          </span>
        </div>
        <div className="stat-grid compact">
          <div>
            <span>Water Depth</span>
            <strong style={{ color: isFloodedNow ? "#4a90ff" : "inherit" }}>
              {current.depth_m.toFixed(2)} m
            </strong>
          </div>
          <div>
            <span>Flow Velocity</span>
            <strong>{current.velocity_mps.toFixed(2)} m/s</strong>
          </div>
          <div>
            <span>Velocity Vector</span>
            <small className="mono">u: {current.u_mps.toFixed(2)}, v: {current.v_mps.toFixed(2)}</small>
          </div>
          <div>
            <span>Arrival Status</span>
            <small>
              {pointData.arrival_time_min !== null
                ? current.t_minutes >= pointData.arrival_time_min
                  ? `Arrived at T+${pointData.arrival_time_min}m`
                  : `Arrives in ${pointData.arrival_time_min - current.t_minutes}m`
                : "Not reached"}
            </small>
          </div>
        </div>
      </div>

      {/* Temporal Summary */}
      <div className="temporal-summary">
        <div className="summary-item">
          <span className="summary-label">Water Arrival Time</span>
          <strong className={`arrival-value ${pointData.arrival_time_min !== null ? "arrived" : "safe"}`}>
            {pointData.arrival_time_min !== null ? `T+${pointData.arrival_time_min} min` : "Not reached"}
          </strong>
        </div>
        <div className="summary-item">
          <span className="summary-label">Max Modeled Depth</span>
          <strong>{pointData.max_depth_m.toFixed(2)} m</strong>
        </div>
        <div className="summary-item">
          <span className="summary-label">Max Velocity</span>
          <strong>{pointData.max_velocity_mps.toFixed(2)} m/s</strong>
        </div>
      </div>

      {/* Interactive Time-Series Sparkline / Bar Chart */}
      <div className="sparkline-section">
        <div className="sparkline-header">
          <span>Depth Evolution Over Time (0–240 min)</span>
          <span className="subtle">Click bar to jump</span>
        </div>
        <div className="depth-bars">
          {timeseries.map((ts, idx) => {
            const heightPct = Math.max(6, Math.min(100, (ts.depth_m / Math.max(maxDepth, 0.5)) * 100));
            const isActive = idx === frameIndex;
            return (
              <div
                key={ts.t_minutes}
                className={`depth-bar-wrapper ${isActive ? "active" : ""}`}
                onClick={() => onSelectTimestep(idx)}
                title={`T+${ts.t_minutes} min: ${ts.depth_m.toFixed(2)} m, ${ts.velocity_mps.toFixed(2)} m/s`}
              >
                <div
                  className="depth-bar"
                  style={{
                    height: `${heightPct}%`,
                    background: getDepthColor(ts.depth_m),
                  }}
                />
                <span className="depth-bar-label">{ts.t_minutes}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detailed Time-Series Table */}
      <details className="timeseries-details">
        <summary>View Complete Time-Series Table (17 Timesteps)</summary>
        <div className="timeseries-table-container">
          <table className="timeseries-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Depth</th>
                <th>Velocity</th>
                <th>Flow (u, v)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {timeseries.map((ts, idx) => {
                const isActive = idx === frameIndex;
                return (
                  <tr
                    key={ts.t_minutes}
                    className={isActive ? "active-row" : ""}
                    onClick={() => onSelectTimestep(idx)}
                    title="Click to jump timeline"
                  >
                    <td className="mono">T+{ts.t_minutes}m</td>
                    <td className="mono">{ts.depth_m.toFixed(2)}m</td>
                    <td className="mono">{ts.velocity_mps.toFixed(2)}m/s</td>
                    <td className="mono subtle">({ts.u_mps.toFixed(2)}, {ts.v_mps.toFixed(2)})</td>
                    <td>
                      <span className={`mini-status ${ts.is_flooded ? "wet" : "dry"}`}>
                        {ts.is_flooded ? "Flooded" : "Dry"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
