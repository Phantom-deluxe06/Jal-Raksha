import { useEffect, useState } from "react";
import {
  fetchRealtimeWaterExtent,
  fetchSarComparison,
  fetchGeeAuthStatus,
  DEFAULT_JOB_ID,
} from "../api";
import { IconSatellite, IconCheck, IconArrowRight } from "./icons";

function formatUtcAsLocal(isoUtc) {
  if (!isoUtc) return "—";
  try {
    return new Date(isoUtc).toLocaleString();
  } catch {
    return isoUtc;
  }
}

export default function RealtimeSar({
  jobId = DEFAULT_JOB_ID,
  meta,
  frameIndex = 0,
  onData,
  onDifferenceData,
}) {
  const [authStatus, setAuthStatus] = useState(null);
  const [data, setData] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [comparing, setComparing] = useState(false);

  // Query Parameters
  const [searchMode, setSearchMode] = useState("latest"); // "latest" | "custom_dates"
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [orbitPass, setOrbitPass] = useState("all");
  const [thresholdDb, setThresholdDb] = useState(-17.0);
  const [showAuthGuide, setShowAuthGuide] = useState(false);

  // Check auth status on mount
  useEffect(() => {
    fetchGeeAuthStatus()
      .then(setAuthStatus)
      .catch((e) => console.warn("GEE Auth status check failed:", e.message));
  }, []);

  const loadData = () => {
    setLoading(true);
    setError(null);
    const params = {
      threshold_db: thresholdDb,
    };
    if (searchMode === "custom_dates") {
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
    }
    if (orbitPass !== "all") {
      params.orbit_pass = orbitPass;
    }

    fetchRealtimeWaterExtent(params)
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

  useEffect(() => {
    loadData();
  }, []);

  const runComparison = () => {
    setComparing(true);
    setError(null);

    const options = {
      frame_index: frameIndex,
      threshold_db: thresholdDb,
    };
    if (searchMode === "custom_dates") {
      if (startDate) options.start_date = startDate;
      if (endDate) options.end_date = endDate;
    }
    if (orbitPass !== "all") {
      options.orbit_pass = orbitPass;
    }

    fetchSarComparison(jobId, options)
      .then((res) => {
        setComparison(res);
        if (res.difference_geojson && onDifferenceData) {
          onDifferenceData(res.difference_geojson);
        }
      })
      .catch((e) => {
        setError(e.message);
      })
      .finally(() => setComparing(false));
  };

  const isAuthMissing = authStatus && !authStatus.authenticated;

  return (
    <div className="sar-module-panel">
      {/* Header & Auth Banner */}
      <div className="sar-header">
        <div className="twin-badge-row">
          <span className="twin-type-badge realtime-badge">
            <IconSatellite /> REAL-TIME SATELLITE OBSERVATION
          </span>
          {authStatus && (
            <span className={`sar-auth-badge ${authStatus.authenticated ? "auth-ok" : "auth-missing"}`}>
              {authStatus.authenticated ? "● Earth Engine Active" : "○ GEE Auth Required"}
            </span>
          )}
        </div>
        <h2>Sentinel-1 SAR — Live Water Extent & Validation</h2>
        <p className="subtle">
          Direct satellite radar observation over the Kosi study area via Google Earth Engine (COPERNICUS/S1_GRD).
          Smooth water surfaces act as specular reflectors, yielding low VV-band backscatter.
        </p>
      </div>

      {/* Developer Authentication Guide Modal / Alert */}
      {isAuthMissing && (
        <div className="sar-auth-alert">
          <div className="auth-alert-head">
            <strong>⚠️ Google Earth Engine Authentication Not Configured</strong>
            <button className="auth-toggle-btn" onClick={() => setShowAuthGuide((v) => !v)}>
              {showAuthGuide ? "Hide Setup Instructions" : "View Setup Instructions"}
            </button>
          </div>
          <p className="subtle">
            To query live Sentinel-1 radar scenes, configure Earth Engine credentials in the backend. Zero-invention policy active: no fake satellite observations are generated.
          </p>
          {showAuthGuide && (
            <div className="auth-guide-box">
              <pre>{authStatus.instructions || "1. Create GCP Service Account\n2. Download key to backend/credentials/service_account.json"}</pre>
            </div>
          )}
        </div>
      )}

      {/* Query Parameters Form */}
      <div className="sar-controls-card">
        <div className="sar-controls-grid">
          <div>
            <label>Acquisition Mode:</label>
            <select
              value={searchMode}
              onChange={(e) => setSearchMode(e.target.value)}
            >
              <option value="latest">Latest Available Scene (Live 30d)</option>
              <option value="custom_dates">Custom Date Range</option>
            </select>
          </div>

          <div>
            <label>Orbit Pass:</label>
            <select value={orbitPass} onChange={(e) => setOrbitPass(e.target.value)}>
              <option value="all">Both (Ascending & Descending)</option>
              <option value="ASCENDING">Ascending Pass</option>
              <option value="DESCENDING">Descending Pass</option>
            </select>
          </div>

          <div>
            <label>VV Water Threshold:</label>
            <div className="threshold-input-row">
              <input
                type="number"
                step="0.5"
                min="-25"
                max="-10"
                value={thresholdDb}
                onChange={(e) => setThresholdDb(parseFloat(e.target.value))}
              />
              <span className="unit-label">dB</span>
            </div>
          </div>
        </div>

        {searchMode === "custom_dates" && (
          <div className="sar-date-inputs">
            <div>
              <label>Start Date:</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label>End Date:</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="sar-action-row">
          <button className="sar-query-btn" onClick={loadData} disabled={loading}>
            {loading ? "Querying Earth Engine live…" : "🛰️ Query Latest Sentinel-1 Scene"}
          </button>
          <button
            className="sar-compare-btn"
            onClick={runComparison}
            disabled={loading || comparing}
          >
            {comparing ? "Evaluating spatial intersection…" : "⚖️ Compare with SWE Simulation"}
          </button>
        </div>
      </div>

      {loading && (
        <div className="panel-loading">
          <span className="spinner" /> Querying Google Earth Engine for Sentinel-1 GRD imagery…
        </div>
      )}

      {error && (
        <div className="sar-error-box">
          <p className="warn">❌ {error}</p>
          <button className="predict-btn" onClick={loadData} style={{ marginTop: "8px" }}>
            Retry Query
          </button>
        </div>
      )}

      {/* Observation Statistics & Data Provenance */}
      {data && !loading && (
        <>
          <div className="stat-grid">
            <div>
              <span>Detected Water Area</span>
              <strong>{data.water_area_km2 !== null ? `${data.water_area_km2.toLocaleString()} km²` : "—"}</strong>
            </div>
            <div>
              <span>Scenes in Window</span>
              <strong>{data.source.scenes_available_in_window || data.source.scenes_available_last_30d}</strong>
            </div>
            <div>
              <span>Orbit Pass</span>
              <strong>{data.source.orbit_pass || "Mixed"}</strong>
            </div>
            <div>
              <span>Query Latency</span>
              <strong>{data.query_duration_s}s</strong>
            </div>
          </div>

          <div className="twin-timestamps">
            <div>
              <span>Satellite Pass Acquired:</span> {formatUtcAsLocal(data.source.acquired_utc)}
            </div>
            <div>
              <span>Live Query Executed:</span> {formatUtcAsLocal(data.queried_at_utc)}
            </div>
          </div>

          {/* Model vs Satellite Comparison Section */}
          {comparison && (
            <div className="sar-comparison-section">
              <h3>Model vs Satellite Observation Comparison</h3>

              {/* Temporal Discrepancy Alert */}
              {comparison.temporal_alignment?.warning && (
                <div className="sar-temporal-warning">
                  <strong>⚠️ Temporal Alignment Note</strong>
                  <p>{comparison.temporal_alignment.warning}</p>
                </div>
              )}

              {/* Validation Metrics Grid */}
              <div className="comparison-metrics-grid">
                <div className="metric-box">
                  <span>IoU (Jaccard Index)</span>
                  <strong className="metric-hl">{(comparison.metrics.iou_jaccard_index * 100).toFixed(1)}%</strong>
                  <span className="metric-desc">Intersection over Union</span>
                </div>
                <div className="metric-box">
                  <span>Precision</span>
                  <strong>{(comparison.metrics.precision * 100).toFixed(1)}%</strong>
                  <span className="metric-desc">Agreement / Model Area</span>
                </div>
                <div className="metric-box">
                  <span>Recall</span>
                  <strong>{(comparison.metrics.recall * 100).toFixed(1)}%</strong>
                  <span className="metric-desc">Agreement / Observed Area</span>
                </div>
                <div className="metric-box">
                  <span>F1 / Dice Score</span>
                  <strong>{(comparison.metrics.f1_dice_score * 100).toFixed(1)}%</strong>
                  <span className="metric-desc">Harmonic Mean</span>
                </div>
              </div>

              {/* Area Breakdown Table */}
              <div className="comparison-areas-table">
                <table>
                  <thead>
                    <tr>
                      <th>Spatial Class</th>
                      <th>Area (km²)</th>
                      <th>Map Layer Color</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>
                        <strong>Agreement (True Positive)</strong>
                        <span className="subtle-block">Both simulated & observed</span>
                      </td>
                      <td>{comparison.areas_km2.agreement_area.toLocaleString()} km²</td>
                      <td><span className="legend-dot dot-agree" /> Green (#2ecc71)</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>Simulated Only (Overestimation)</strong>
                        <span className="subtle-block">Modeled flood not seen in SAR</span>
                      </td>
                      <td>{comparison.areas_km2.simulated_only_area.toLocaleString()} km²</td>
                      <td><span className="legend-dot dot-sim" /> Blue (#3498db)</td>
                    </tr>
                    <tr>
                      <td>
                        <strong>SAR Observed Only</strong>
                        <span className="subtle-block">Baseline river channels / wetlands</span>
                      </td>
                      <td>{comparison.areas_km2.observed_only_area.toLocaleString()} km²</td>
                      <td><span className="legend-dot dot-obs" /> Orange (#e67e22)</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Data Provenance & Methodology Details */}
          <details className="sar-provenance-details" open>
            <summary>Data Provenance & Methodology</summary>
            <ul className="assumptions">
              <li>
                <strong>Satellite Constellation:</strong> {data.source.satellite || "Copernicus Sentinel-1"} (C-Band Synthetic Aperture Radar, 5.405 GHz)
              </li>
              <li>
                <strong>Scene Identifier:</strong> <code>{data.source.scene_id}</code>
              </li>
              <li>
                <strong>Acquisition Timestamp:</strong> {data.source.acquired_utc} (UTC)
              </li>
              <li>
                <strong>Polarisation & Mode:</strong> {data.source.polarization} polarization in Interferometric Wide (IW) swath mode.
              </li>
              <li>
                <strong>Detection Method:</strong> {data.detection_method.technique} ($\sigma_0 &lt; {data.detection_method.threshold_db}\text{ dB}$) evaluated at {data.detection_method.reduce_scale_m}m spatial resolution.
              </li>
              <li>
                <strong>Active Simulation Scenario:</strong> {meta?.scenario_label || "Kosi 2008 — Historical Validation"} ({jobId})
              </li>
              <li className="warn">
                <strong>Methodological Caveat:</strong> {data.detection_method.caveat}
              </li>
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
