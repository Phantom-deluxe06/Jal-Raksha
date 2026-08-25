import { useEffect, useState } from "react";
import { fetchRealtimeWaterExtent } from "../api";

function formatUtcAsLocal(isoUtc) {
  try {
    return new Date(isoUtc).toLocaleString();
  } catch {
    return isoUtc;
  }
}

export default function RealtimeSar({ onData }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError(null);
    fetchRealtimeWaterExtent()
      .then((result) => {
        setData(result);
        onData?.(result);
      })
      .catch((e) => {
        setError(e.message);
        onData?.(null);
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <div className="sph-panel">
      <div className="twin-badge-row">
        <span className="twin-type-badge realtime-badge">REAL-TIME SATELLITE OBSERVATION</span>
      </div>
      <h2>Sentinel-1 SAR — Live Water Extent</h2>
      <p className="subtle">
        Not a simulation — this is the actual most recent Sentinel-1 radar scene over the AOI,
        queried live from Google Earth Engine on every load. Distinct from the SWE/SPH modeled
        layers elsewhere in this app.
      </p>

      {loading && <p className="subtle">Querying Earth Engine live…</p>}

      {error && (
        <>
          <p className="warn">{error}</p>
          <button className="predict-btn" onClick={load} disabled={loading}>
            Retry query
          </button>
        </>
      )}

      {data && !loading && (
        <>
          <div className="stat-grid">
            <div><span>Water extent detected</span><strong>{data.water_area_km2 ?? "—"} km²</strong></div>
            <div><span>Scenes found (30d)</span><strong>{data.source.scenes_available_last_30d}</strong></div>
            <div><span>Query latency</span><strong>{data.query_duration_s}s</strong></div>
            <div><span>Orbit pass</span><strong>{data.source.orbit_pass}</strong></div>
          </div>

          <div className="twin-timestamps">
            <div><span>Satellite pass acquired:</span> {formatUtcAsLocal(data.source.acquired_utc)}</div>
            <div><span>Queried by this app:</span> {formatUtcAsLocal(data.queried_at_utc)}</div>
          </div>

          <p className="subtle realtime-cadence">
            Sentinel-1 revisits this AOI roughly every 6–12 days (mixed orbit coverage) — this is
            genuinely the newest scene available, not a stale cache. Requerying before the next
            pass will keep returning this same scene, honestly.
          </p>

          <button className="predict-btn" onClick={load} disabled={loading}>
            Query again now
          </button>

          <details>
            <summary>Detection method & honesty notes</summary>
            <ul className="assumptions">
              <li>
                Scene: <code>{data.source.scene_id}</code>
              </li>
              <li>
                Method: {data.detection_method.technique} (VV backscatter &lt;{" "}
                {data.detection_method.threshold_db} dB flagged as water), at{" "}
                {data.detection_method.reduce_scale_m}m resolution.
              </li>
              <li>{data.detection_method.explanation}</li>
              <li className="warn">{data.detection_method.caveat}</li>
              <li>
                Source: <a href="https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S1_GRD" target="_blank" rel="noreferrer">
                  COPERNICUS/S1_GRD
                </a> via Google Earth Engine.
              </li>
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
