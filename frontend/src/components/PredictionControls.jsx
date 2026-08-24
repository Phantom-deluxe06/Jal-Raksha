import { useState } from "react";

const M_PER_DEG_LAT = 111320;

export default function PredictionControls({ baseDischarge, baseLat, baseLon, onResult }) {
  const qLo = baseDischarge * 0.5;
  const qHi = baseDischarge * 1.5;
  const [discharge, setDischarge] = useState(baseDischarge);
  const [offsetKm, setOffsetKm] = useState({ ns: 0, ew: 0 }); // +/- ~1.8km, matches training jitter
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastStats, setLastStats] = useState(null);

  const mPerDegLon = M_PER_DEG_LAT * Math.cos((baseLat * Math.PI) / 180);
  const lat = baseLat + (offsetKm.ns * 1000) / M_PER_DEG_LAT;
  const lon = baseLon + (offsetKm.ew * 1000) / mPerDegLon;

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const { predictInstant } = await import("../api");
      const t0 = performance.now();
      const result = await predictInstant({ discharge_cumecs: discharge, lat, lon });
      const clientMs = performance.now() - t0;
      setLastStats({ ...result, client_round_trip_s: (clientMs / 1000).toFixed(2) });
      onResult(result, { lat, lon });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="prediction-controls">
      <div className="control-row">
        <label>Discharge: {Math.round(discharge).toLocaleString()} m³/s</label>
        <input
          type="range" min={qLo} max={qHi} step={10} value={discharge}
          onChange={(e) => setDischarge(Number(e.target.value))}
        />
        <button className="reset-link" onClick={() => setDischarge(baseDischarge)}>reset to actual 2008 (3675)</button>
      </div>

      <div className="control-row">
        <label>Breach location N/S offset: {offsetKm.ns.toFixed(2)} km</label>
        <input
          type="range" min={-1.8} max={1.8} step={0.05} value={offsetKm.ns}
          onChange={(e) => setOffsetKm((o) => ({ ...o, ns: Number(e.target.value) }))}
        />
      </div>
      <div className="control-row">
        <label>Breach location E/W offset: {offsetKm.ew.toFixed(2)} km</label>
        <input
          type="range" min={-1.8} max={1.8} step={0.05} value={offsetKm.ew}
          onChange={(e) => setOffsetKm((o) => ({ ...o, ew: Number(e.target.value) }))}
        />
      </div>

      <button className="predict-btn" onClick={run} disabled={loading}>
        {loading ? "Predicting…" : "Run instant AI prediction"}
      </button>

      {error && <p className="warn">{error}</p>}

      {lastStats && (
        <div className="predict-stats">
          <div>Server inference time: <strong>{lastStats.inference_s}s</strong></div>
          <div>Round-trip (incl. network): <strong>{lastStats.client_round_trip_s}s</strong></div>
          <div>Predicted flooded area: <strong>{lastStats.flooded_area_km2} km²</strong></div>
          <div>Predicted max depth: <strong>{lastStats.max_depth_m} m</strong></div>
          <div>Grid resolution: <strong>{lastStats.grid_resolution_m[0]}m × {lastStats.grid_resolution_m[1]}m</strong> (coarser than Full SWE mode)</div>
          <p className="subtle">{lastStats.caveat}</p>
        </div>
      )}
    </div>
  );
}
