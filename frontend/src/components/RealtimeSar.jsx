import { useEffect, useState } from "react";
import { fetchRealtimeWaterExtent, compareSarWithSimulation } from "../api";

function formatUtcAsLocal(isoUtc) {
  if (!isoUtc) return "—";
  try {
    return new Date(isoUtc).toLocaleString();
  } catch {
    return isoUtc;
  }
}

export default function RealtimeSar({
  onData,
  onComparisonChange,
  sarLayers,
  setSarLayers,
  frameIndex = 0,
  frames = [],
}) {
  const [data, setData] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [error, setError] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [comparing, setComparing] = useState(false);

  const activeTimestep = frames[frameIndex]?.t_minutes ?? null;

  const load = () => {
    setLoading(true);
    setError(null);
    setAuthError(null);
    fetchRealtimeWaterExtent()
      .then((result) => {
        setData(result);
        onData?.(result);
        runComparison(result, activeTimestep);
      })
      .catch((e) => {
        if (e.message && e.message.includes("401")) {
          setAuthError({
            message: "Google Earth Engine service account credentials required.",
            instructions: [
              "1. Place your GCP Service Account JSON key at backend/credentials/service_account.json",
              "2. Or set GOOGLE_APPLICATION_CREDENTIALS environment variable",
              "3. Or run 'gcloud auth application-default login' in terminal",
            ],
          });
        } else {
          setError(e.message || "Failed to query Sentinel-1 SAR via Earth Engine.");
        }
        onData?.(null);
      })
      .finally(() => setLoading(false));
  };

  const runComparison = async (sarData, timestep) => {
    setComparing(true);
    try {
      const compResult = await compareSarWithSimulation({
        timestep_minutes: timestep,
        sar_extent: sarData,
      });
      setComparison(compResult);
      onComparisonChange?.(compResult);
    } catch (e) {
      console.warn("Spatial comparison calculation note:", e);
    } finally {
      setComparing(false);
    }
  };

  useEffect(load, []);

  useEffect(() => {
    if (data) {
      runComparison(data, activeTimestep);
    }
  }, [activeTimestep]);

  const toggleLayer = (key) => {
    setSarLayers?.((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  return (
    <div className="sph-panel">
      <div className="twin-badge-row">
        <span className="twin-type-badge realtime-badge">SATELLITE OBSERVATION & VALIDATION</span>
      </div>
      <h2>Sentinel-1 SAR — Live Observation vs Model</h2>
      <p className="subtle">
        Real Sentinel-1 C-band radar observations queried live from Google Earth Engine, spatially compared with the SWE simulation output.
      </p>

      {/* Layer Toggle Toolbar */}
      <div className="sar-layer-toolbar">
        <div className="layer-toolbar-title">Map Layers</div>
        <div className="layer-buttons-grid">
          <button
            className={`layer-btn ${sarLayers?.showSim ? "active sim" : ""}`}
            onClick={() => toggleLayer("showSim")}
          >
            <span className="layer-dot sim" />
            SWE Simulation
          </button>

          <button
            className={`layer-btn ${sarLayers?.showSar ? "active sar" : ""}`}
            onClick={() => toggleLayer("showSar")}
          >
            <span className="layer-dot sar" />
            SAR Water Extent
          </button>

          <button
            className={`layer-btn ${sarLayers?.showDiff ? "active diff" : ""}`}
            onClick={() => toggleLayer("showDiff")}
          >
            <span className="layer-dot diff" />
            Difference Map
          </button>

          <button
            className={`layer-btn ${sarLayers?.baseSatellite ? "active sat" : ""}`}
            onClick={() => toggleLayer("baseSatellite")}
          >
            <span className="layer-dot sat" />
            Satellite Basemap
          </button>
        </div>
      </div>

      {loading && (
        <div className="panel-loading">
          <span className="spinner" />
          Querying Google Earth Engine for newest Sentinel-1 GRD scene…
        </div>
      )}

      {/* Authentication Advisory Modal / Card */}
      {authError && (
        <div className="auth-advisory-card">
          <div className="auth-header">
            <span className="auth-icon">🔑</span>
            <h3>Earth Engine Authentication Setup</h3>
          </div>
          <p className="auth-msg">{authError.message}</p>
          <div className="auth-steps">
            <strong>Setup Instructions:</strong>
            <ul>
              {authError.instructions.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ul>
          </div>
          <p className="subtle auth-note">
            The platform executes real Earth Engine queries without fabricated fallbacks. Once credentials are in place, click Retry below.
          </p>
          <button className="predict-btn" onClick={load} disabled={loading}>
            Retry Earth Engine Query
          </button>
        </div>
      )}

      {error && !authError && (
        <div className="error-card">
          <p className="warn">{error}</p>
          <button className="predict-btn" onClick={load} disabled={loading}>
            Retry query
          </button>
        </div>
      )}

      {data && !loading && (
        <>
          {/* Spatial Comparison Metrics */}
          {comparison && (
            <div className="comparison-card">
              <div className="comparison-header">
                <h3>Model vs Satellite Observation</h3>
                <span className="comparison-tag">{comparison.timestep_label}</span>
              </div>

              <div className="stat-grid comparison-metrics">
                <div className="metric-box agreement">
                  <span>Agreement (Sim ∩ Obs)</span>
                  <strong>{comparison.metrics.agreement_area_km2} km²</strong>
                </div>
                <div className="metric-box sim-only">
                  <span>Simulated Only</span>
                  <strong>{comparison.metrics.simulated_only_area_km2} km²</strong>
                </div>
                <div className="metric-box obs-only">
                  <span>Observed SAR Only</span>
                  <strong>{comparison.metrics.observed_only_area_km2} km²</strong>
                </div>
                <div className="metric-box">
                  <span>IoU Metric</span>
                  <strong>{(comparison.metrics.iou * 100).toFixed(1)}%</strong>
                </div>
                <div className="metric-box">
                  <span>Precision</span>
                  <strong>{(comparison.metrics.precision * 100).toFixed(1)}%</strong>
                </div>
                <div className="metric-box">
                  <span>Recall</span>
                  <strong>{(comparison.metrics.recall * 100).toFixed(1)}%</strong>
                </div>
              </div>

              {/* Difference Map Legend */}
              <div className="diff-legend">
                <div className="diff-legend-item">
                  <span className="diff-chip" style={{ background: "#3ddc97" }} />
                  <span>Agreement (Flooded in Model & SAR)</span>
                </div>
                <div className="diff-legend-item">
                  <span className="diff-chip" style={{ background: "#4a90ff" }} />
                  <span>Model Only (Simulated Breach Corridor)</span>
                </div>
                <div className="diff-legend-item">
                  <span className="diff-chip" style={{ background: "#ff9f1c" }} />
                  <span>SAR Only (Current Kosi Main Channel)</span>
                </div>
              </div>
            </div>
          )}

          {/* Satellite Acquisition Stats */}
          <div className="stat-grid">
            <div><span>Observed water area</span><strong>{data.water_area_km2 ?? "—"} km²</strong></div>
            <div><span>Available scenes (30d)</span><strong>{data.source.scenes_available_last_30d}</strong></div>
            <div><span>Query duration</span><strong>{data.query_duration_s}s</strong></div>
            <div><span>Orbit pass</span><strong>{data.source.orbit_pass}</strong></div>
          </div>

          <div className="twin-timestamps">
            <div><span>Satellite pass acquired:</span> {formatUtcAsLocal(data.source.acquired_utc)}</div>
            <div><span>Live queried by app:</span> {formatUtcAsLocal(data.queried_at_utc)}</div>
          </div>

          {/* Temporal Advisory Warning */}
          <div className="temporal-notice-box">
            <span className="notice-icon">⏳</span>
            <div>
              <strong>Temporal Advisory Notice</strong>
              <p>
                The Sentinel-1 SAR observation reflects <em>recent surface water conditions</em> ({formatUtcAsLocal(data.source.acquired_utc)}), whereas the SWE simulation models the <em>18 August 2008 historical breach</em>. The comparison highlights differences between the active permanent river channel and the 2008 breach avulsion pathway.
              </p>
            </div>
          </div>

          <button className="predict-btn" onClick={load} disabled={loading || comparing}>
            Refresh Live SAR Query
          </button>

          {/* Provenance & Methodology */}
          <details className="provenance-details">
            <summary>Data Provenance & Detection Methodology</summary>
            <ul className="assumptions">
              <li>
                <strong>Satellite:</strong> {data.source.satellite} ({data.source.sensor})
              </li>
              <li>
                <strong>Collection:</strong> <code>{data.source.collection}</code> (Scene: <code>{data.source.scene_id}</code>)
              </li>
              <li>
                <strong>Polarization & Mode:</strong> {data.source.polarization}, {data.source.instrument_mode}
              </li>
              <li>
                <strong>Water Extraction:</strong> {data.detection_method.technique} (Threshold: {data.detection_method.threshold_db} dB at {data.detection_method.reduce_scale_m}m vector scale)
              </li>
              <li>
                <strong>Explanation:</strong> {data.detection_method.explanation}
              </li>
              <li className="warn">
                <strong>Caveat:</strong> {data.detection_method.caveat}
              </li>
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
