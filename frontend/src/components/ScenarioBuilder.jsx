import { useState, useEffect } from "react";
import {
  fetchScenarioPresets,
  fetchScenarioList,
  validateScenario,
  runScenario,
  fetchScenarioStatus,
  fetchResult,
} from "../api";
import { IconCheck, IconArrowRight, IconSliders, IconWaves, IconGauge } from "./icons";

const KOSI_BOUNDS = {
  west: 86.6,
  south: 25.9,
  east: 87.3,
  north: 26.7,
};

const COORD_PRESETS = [
  { name: "Kusaha Breach Site (Documented 2008)", lat: 26.62, lon: 87.05 },
  { name: "Kosi Barrage (Bhimnagar Gates)", lat: 26.5263, lon: 86.9269 },
  { name: "North-East Afflux Bund (Nepal Sector)", lat: 26.65, lon: 87.02 },
  { name: "Supaul Border Sector", lat: 26.45, lon: 86.95 },
];

export default function ScenarioBuilder({ onScenarioSelect, onEnterView, activeJobId }) {
  const [presets, setPresets] = useState([]);
  const [existingRuns, setExistingRuns] = useState([]);
  const [selectedPresetId, setSelectedPresetId] = useState("kosi_actual2008");
  
  // Scenario Configuration State
  const [scenarioId, setScenarioId] = useState("kosi_actual2008");
  const [scenarioName, setScenarioName] = useState("Kosi 2008 — Historical Validation");
  const [scenarioType, setScenarioType] = useState("historical");
  const [description, setDescription] = useState(
    "Documented 18 Aug 2008 Kusaha afflux embankment breach on the Kosi River. Reference validation case."
  );

  // Water & Inflow
  const [dischargeCumecs, setDischargeCumecs] = useState(3675);
  const [dischargeSource, setDischargeSource] = useState("Documented 18 Aug 2008 actual breach discharge");

  // Breach / Release Location & Geometry
  const [breachSiteName, setBreachSiteName] = useState("Kusaha Breach Site");
  const [breachLat, setBreachLat] = useState(26.62);
  const [breachLon, setBreachLon] = useState(87.05);
  const [breachWidthM, setBreachWidthM] = useState(100);
  const [rampMinutes, setRampMinutes] = useState(30);

  // Simulation Parameters
  const [durationHours, setDurationHours] = useState(4.0);
  const [snapshotIntervalMin, setSnapshotIntervalMin] = useState(15.0);
  const [manningN, setManningN] = useState(0.035);

  // Execution & Status State
  const [jobStatus, setJobStatus] = useState("idle"); // "idle" | "queued" | "running" | "processing" | "complete" | "failed"
  const [statusMessage, setStatusMessage] = useState("");
  const [validationResult, setValidationResult] = useState(null);
  const [error, setError] = useState(null);
  const [activeRunningJobId, setActiveRunningJobId] = useState(null);

  // Load Presets and Existing Runs on Mount
  useEffect(() => {
    fetchScenarioPresets()
      .then((data) => {
        if (data && data.presets) {
          setPresets(data.presets);
        }
      })
      .catch((e) => console.error("Error fetching presets:", e));

    loadExistingRuns();
  }, []);

  const loadExistingRuns = () => {
    fetchScenarioList()
      .then((data) => {
        if (data && data.scenarios) {
          setExistingRuns(data.scenarios);
        }
      })
      .catch((e) => console.error("Error fetching runs:", e));
  };

  // Switch Preset Handler
  const handleSelectPreset = (preset) => {
    setSelectedPresetId(preset.metadata.scenario_id);
    setScenarioId(preset.metadata.scenario_id);
    setScenarioName(preset.metadata.name);
    setScenarioType(preset.metadata.scenario_type);
    setDescription(preset.metadata.description || "");

    setDischargeCumecs(preset.waterConditions.peak_discharge_cumecs);
    setDischargeSource(preset.waterConditions.discharge_source || "");

    setBreachSiteName(preset.breach.site_name || "Breach Site");
    setBreachLat(preset.breach.coordinates.lat);
    setBreachLon(preset.breach.coordinates.lon);
    setBreachWidthM(preset.breach.width_m);
    setRampMinutes(preset.breach.ramp_minutes);

    setDurationHours(preset.simulation.duration_hours);
    setSnapshotIntervalMin(preset.simulation.snapshot_interval_minutes);
    setManningN(preset.simulation.manning_n || 0.035);

    setValidationResult(null);
    setError(null);
    setJobStatus("idle");
  };

  // Compile Current Scenario Object
  const compileScenario = () => {
    return {
      metadata: {
        scenario_id: scenarioId.trim() || `custom_${Date.now()}`,
        name: scenarioName.trim() || "Custom Scenario",
        scenario_type: scenarioType,
        description: description.trim(),
        author: "FloodSim Operator",
        created_at: new Date().toISOString(),
      },
      studyArea: {
        name: "Kosi River Basin (North Bihar / Sunsari AOI)",
        river_name: "Kosi (Koshi) River",
        basin: "Kosi Basin, Ganga Sub-basin",
        dem_file: "data/dem/kosi_aoi_srtm30m.tif",
        bounds: KOSI_BOUNDS,
      },
      dam: {
        name: scenarioType === "controlled_release" ? "Kosi Barrage Gates" : "Kusaha Afflux Embankment",
        structure_type: scenarioType === "controlled_release" ? "gated_barrage_release" : "embankment_breach",
        barrage_name: "Kosi Barrage (Bhimnagar)",
        barrage_coordinates: { lat: 26.5263, lon: 86.9269 },
      },
      breach: {
        site_name: breachSiteName,
        coordinates: { lat: Number(breachLat), lon: Number(breachLon) },
        width_m: Number(breachWidthM),
        ramp_minutes: Number(rampMinutes),
      },
      initialConditions: {
        bed_condition: "dry_bed",
        initial_depth_m: 0.0,
      },
      waterConditions: {
        peak_discharge_cumecs: Number(dischargeCumecs),
        discharge_source: dischargeSource,
        design_discharge_cumecs_NOT_USED: 27000.0,
      },
      simulation: {
        duration_hours: Number(durationHours),
        snapshot_interval_minutes: Number(snapshotIntervalMin),
        target_resolution_deg: 0.0016667,
        manning_n: Number(manningN),
        cfl: 0.4,
        flood_depth_threshold_m: 0.1,
      },
    };
  };

  // Client Validation
  const validateForm = () => {
    const errors = [];
    const warnings = [];

    if (breachLat < KOSI_BOUNDS.south || breachLat > KOSI_BOUNDS.north) {
      errors.push(`Latitude must be within the DEM AOI: ${KOSI_BOUNDS.south}°N to ${KOSI_BOUNDS.north}°N.`);
    }
    if (breachLon < KOSI_BOUNDS.west || breachLon > KOSI_BOUNDS.east) {
      errors.push(`Longitude must be within the DEM AOI: ${KOSI_BOUNDS.west}°E to ${KOSI_BOUNDS.east}°E.`);
    }
    if (isNaN(dischargeCumecs) || dischargeCumecs <= 0) {
      errors.push("Peak discharge must be a positive number.");
    }
    if (isNaN(breachWidthM) || breachWidthM <= 0) {
      errors.push("Breach width must be a positive number.");
    }
    if (isNaN(rampMinutes) || rampMinutes < 0) {
      errors.push("Breach ramp duration cannot be negative.");
    }
    if (isNaN(durationHours) || durationHours <= 0) {
      errors.push("Simulation duration must be greater than 0 hours.");
    } else if (durationHours > 8) {
      warnings.push("Simulation duration > 8h requires extended computation time.");
    }
    if (isNaN(snapshotIntervalMin) || snapshotIntervalMin <= 0) {
      errors.push("Snapshot interval must be greater than 0 minutes.");
    } else if (snapshotIntervalMin > durationHours * 60) {
      errors.push("Snapshot interval cannot exceed total simulation duration.");
    }
    if (isNaN(manningN) || manningN <= 0 || manningN > 0.15) {
      errors.push("Manning's n must be within physical range (0.015 - 0.100).");
    }

    const estimatedTimesteps = Math.round((durationHours * 3600) / 10);
    const estimatedFrames = Math.floor((durationHours * 60) / snapshotIntervalMin) + 1;

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      estimated_timesteps: estimatedTimesteps,
      estimated_frames: estimatedFrames,
    };
  };

  const handleValidate = async () => {
    const clientVal = validateForm();
    if (!clientVal.valid) {
      setValidationResult(clientVal);
      return;
    }
    try {
      const scenario = compileScenario();
      const res = await validateScenario(scenario);
      setValidationResult(res);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  };

  // Run Simulation Handler
  const handleRunSimulation = async () => {
    const val = validateForm();
    if (!val.valid) {
      setValidationResult(val);
      return;
    }
    setValidationResult(val);
    setError(null);
    setJobStatus("queued");
    setStatusMessage("Queued simulation job...");

    const scenario = compileScenario();
    const currentJobId = scenario.metadata.scenario_id;
    setActiveRunningJobId(currentJobId);

    try {
      await runScenario(scenario);

      // Honest polling loop without fake progress bars
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetchScenarioStatus(currentJobId);
          setJobStatus(statusRes.status);
          setStatusMessage(statusRes.step_message || statusRes.status);

          if (statusRes.status === "complete") {
            clearInterval(pollInterval);
            loadExistingRuns();
            if (onScenarioSelect) {
              onScenarioSelect(currentJobId);
            }
          } else if (statusRes.status === "failed") {
            clearInterval(pollInterval);
            setError(statusRes.error || "Simulation run failed.");
          }
        } catch (pollErr) {
          console.error("Poll error:", pollErr);
        }
      }, 1500);
    } catch (e) {
      setJobStatus("failed");
      setError(e.message);
    }
  };

  const handleLoadExistingRun = (runJobId) => {
    if (onScenarioSelect) {
      onScenarioSelect(runJobId);
    }
    if (onEnterView) {
      onEnterView("full");
    }
  };

  return (
    <div className="scenario-builder-container">
      {/* Header */}
      <div className="sb-header">
        <div className="sb-header-title">
          <IconSliders />
          <div>
            <h2>Scenario Builder</h2>
            <p className="subtle">
              Configure and run physical 2D Shallow Water Equation simulations across the Kosi River basin.
            </p>
          </div>
        </div>

        {/* Preset Selector */}
        <div className="sb-presets-row">
          <span className="sb-preset-label">Scenario Presets:</span>
          {presets.map((p) => {
            const isSelected = selectedPresetId === p.metadata.scenario_id;
            return (
              <button
                key={p.metadata.scenario_id}
                className={`sb-preset-btn ${isSelected ? "active" : ""}`}
                onClick={() => handleSelectPreset(p)}
              >
                {p.metadata.scenario_type === "historical" && "📜 "}
                {p.metadata.scenario_type === "controlled_release" && "💧 "}
                {p.metadata.scenario_type === "custom_dam_break" && "⚙️ "}
                {p.metadata.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="sb-grid">
        {/* Left Column: Form Configuration */}
        <div className="sb-form-col">
          {/* Metadata Section */}
          <div className="sb-card">
            <div className="sb-card-header">
              <h3>Scenario Identification</h3>
              <span className={`sb-badge badge-${scenarioType}`}>
                {scenarioType === "historical"
                  ? "Historical Validation"
                  : scenarioType === "controlled_release"
                  ? "Controlled Release"
                  : "Custom Dam Break"}
              </span>
            </div>
            <div className="sb-card-body">
              <div className="form-group">
                <label>Scenario Name</label>
                <input
                  type="text"
                  value={scenarioName}
                  onChange={(e) => setScenarioName(e.target.value)}
                  disabled={scenarioType === "historical"}
                />
              </div>
              <div className="form-row-2">
                <div className="form-group">
                  <label>Scenario ID</label>
                  <input
                    type="text"
                    value={scenarioId}
                    onChange={(e) => setScenarioId(e.target.value)}
                    disabled={scenarioType === "historical"}
                  />
                </div>
                <div className="form-group">
                  <label>Scenario Type</label>
                  <select
                    value={scenarioType}
                    onChange={(e) => setScenarioType(e.target.value)}
                    disabled={scenarioType === "historical"}
                  >
                    <option value="historical">Historical Validation</option>
                    <option value="custom_dam_break">Custom Dam Break Scenario</option>
                    <option value="controlled_release">Controlled Water Release</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Description & Notes</label>
                <textarea
                  rows="2"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={scenarioType === "historical"}
                />
              </div>
            </div>
          </div>

          {/* Section 1: Study Area */}
          <div className="sb-card">
            <div className="sb-card-header">
              <h3>1. Study Area & Topography</h3>
              <span className="sb-param-tag">SRTM 30m DEM</span>
            </div>
            <div className="sb-card-body">
              <div className="sb-info-banner">
                <strong>Verified Dataset:</strong> Topography is bound to the high-resolution SRTM 30m digital elevation grid covering the Kosi River Basin (North Bihar / Sunsari AOI: 25.9°N–26.7°N, 86.6°E–87.3°E, ~6,222 km²).
              </div>
              <div className="stat-grid" style={{ marginTop: "10px" }}>
                <div><span>River Basin</span><strong>Kosi (Ganga Sub-basin)</strong></div>
                <div><span>Grid Extent</span><strong>6,221.5 km²</strong></div>
                <div><span>Elevation Range</span><strong>41m – 391m MSL</strong></div>
                <div><span>Bed Roughness (n)</span><strong>{manningN}</strong></div>
              </div>
            </div>
          </div>

          {/* Section 2: Water Conditions */}
          <div className="sb-card">
            <div className="sb-card-header">
              <h3>2. Water Conditions & Inflow</h3>
              <span className="sb-param-tag">Hydrograph Mass Inflow</span>
            </div>
            <div className="sb-card-body">
              <div className="form-group">
                <label>
                  Peak Discharge ($Q_{'{peak}'}$): <strong>{Number(dischargeCumecs).toLocaleString()} m³/s (cumecs)</strong>
                </label>
                <input
                  type="number"
                  min="100"
                  max="40000"
                  step="50"
                  value={dischargeCumecs}
                  onChange={(e) => setDischargeCumecs(Number(e.target.value))}
                  disabled={scenarioType === "historical"}
                />
              </div>
              <div className="quick-buttons">
                <span className="subtle" style={{ fontSize: "12px", alignSelf: "center" }}>Quick presets:</span>
                <button
                  type="button"
                  className="chip-btn"
                  onClick={() => setDischargeCumecs(3675)}
                  disabled={scenarioType === "historical"}
                >
                  3,675 m³/s (2008 Actual)
                </button>
                <button
                  type="button"
                  className="chip-btn"
                  onClick={() => setDischargeCumecs(12000)}
                  disabled={scenarioType === "historical"}
                >
                  12,000 m³/s (High Spillway)
                </button>
                <button
                  type="button"
                  className="chip-btn"
                  onClick={() => setDischargeCumecs(27000)}
                  disabled={scenarioType === "historical"}
                >
                  27,000 m³/s (Design Peak)
                </button>
              </div>

              <div className="form-row-2" style={{ marginTop: "12px" }}>
                <div className="form-group">
                  <label>Initial Bed Condition</label>
                  <select disabled value="dry_bed">
                    <option value="dry_bed">Dry-bed ($h_0 = 0.0\text{"{ m}"}$) — Standard Overland</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Discharge Source Citation</label>
                  <input
                    type="text"
                    value={dischargeSource}
                    onChange={(e) => setDischargeSource(e.target.value)}
                    disabled={scenarioType === "historical"}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Breach Scenario */}
          <div className="sb-card">
            <div className="sb-card-header">
              <h3>3. Breach / Inflow Location & Failure Geometry</h3>
              <span className="sb-param-tag">DEM Sited</span>
            </div>
            <div className="sb-card-body">
              <div className="form-group">
                <label>Breach / Structure Location Name</label>
                <input
                  type="text"
                  value={breachSiteName}
                  onChange={(e) => setBreachSiteName(e.target.value)}
                  disabled={scenarioType === "historical"}
                />
              </div>

              <div className="form-row-2">
                <div className="form-group">
                  <label>Latitude (°N) [25.90 - 26.70]</label>
                  <input
                    type="number"
                    step="0.001"
                    min={KOSI_BOUNDS.south}
                    max={KOSI_BOUNDS.north}
                    value={breachLat}
                    onChange={(e) => setBreachLat(Number(e.target.value))}
                    disabled={scenarioType === "historical"}
                  />
                </div>
                <div className="form-group">
                  <label>Longitude (°E) [86.60 - 87.30]</label>
                  <input
                    type="number"
                    step="0.001"
                    min={KOSI_BOUNDS.west}
                    max={KOSI_BOUNDS.east}
                    value={breachLon}
                    onChange={(e) => setBreachLon(Number(e.target.value))}
                    disabled={scenarioType === "historical"}
                  />
                </div>
              </div>

              <div className="quick-buttons">
                <span className="subtle" style={{ fontSize: "12px", alignSelf: "center" }}>Siting presets:</span>
                {COORD_PRESETS.map((cp) => (
                  <button
                    key={cp.name}
                    type="button"
                    className="chip-btn"
                    onClick={() => {
                      setBreachLat(cp.lat);
                      setBreachLon(cp.lon);
                      setBreachSiteName(cp.name);
                    }}
                    disabled={scenarioType === "historical"}
                  >
                    {cp.name.split(" ")[0]} ({cp.lat}°, {cp.lon}°)
                  </button>
                ))}
              </div>

              <div className="form-row-2" style={{ marginTop: "12px" }}>
                <div className="form-group">
                  <label>Breach Width ($W$): <strong>{breachWidthM} m</strong></label>
                  <input
                    type="range"
                    min="10"
                    max="500"
                    step="5"
                    value={breachWidthM}
                    onChange={(e) => setBreachWidthM(Number(e.target.value))}
                    disabled={scenarioType === "historical"}
                  />
                </div>
                <div className="form-group">
                  <label>
                    {scenarioType === "controlled_release" ? "Gate Opening / Ramp Duration" : "Breach Failure Duration ($T_{ramp}$)"}: <strong>{rampMinutes} min</strong>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="120"
                    step="5"
                    value={rampMinutes}
                    onChange={(e) => setRampMinutes(Number(e.target.value))}
                    disabled={scenarioType === "historical"}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Section 4: Simulation Settings */}
          <div className="sb-card">
            <div className="sb-card-header">
              <h3>4. Simulation Settings</h3>
              <span className="sb-param-tag">2D SWE Solver</span>
            </div>
            <div className="sb-card-body">
              <div className="form-row-3">
                <div className="form-group">
                  <label>Duration: <strong>{durationHours} hours</strong></label>
                  <input
                    type="range"
                    min="1.0"
                    max="8.0"
                    step="0.5"
                    value={durationHours}
                    onChange={(e) => setDurationHours(Number(e.target.value))}
                  />
                </div>
                <div className="form-group">
                  <label>Snapshot Interval</label>
                  <select
                    value={snapshotIntervalMin}
                    onChange={(e) => setSnapshotIntervalMin(Number(e.target.value))}
                  >
                    <option value="5">5 minutes (dense)</option>
                    <option value="10">10 minutes</option>
                    <option value="15">15 minutes (standard)</option>
                    <option value="30">30 minutes (fast)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Manning Roughness ($n$)</label>
                  <input
                    type="number"
                    step="0.005"
                    min="0.020"
                    max="0.080"
                    value={manningN}
                    onChange={(e) => setManningN(Number(e.target.value))}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Validation, Summary & Execution */}
        <div className="sb-summary-col">
          {/* Summary & Execution Card */}
          <div className="sb-card sb-sticky-card">
            <div className="sb-card-header">
              <h3>Configuration Summary</h3>
              <button className="sb-text-btn" onClick={handleValidate}>
                Validate
              </button>
            </div>
            <div className="sb-card-body">
              <div className="sb-summary-list">
                <div className="sb-summary-item">
                  <span>Scenario:</span>
                  <strong>{scenarioName}</strong>
                </div>
                <div className="sb-summary-item">
                  <span>Breach Location:</span>
                  <strong>{breachLat.toFixed(4)}°N, {breachLon.toFixed(4)}°E</strong>
                </div>
                <div className="sb-summary-item">
                  <span>Peak Inflow Discharge:</span>
                  <strong>{Number(dischargeCumecs).toLocaleString()} m³/s</strong>
                </div>
                <div className="sb-summary-item">
                  <span>Breach Geometry:</span>
                  <strong>{breachWidthM}m width · {rampMinutes}m ramp</strong>
                </div>
                <div className="sb-summary-item">
                  <span>Simulated Duration:</span>
                  <strong>{durationHours} hours ({snapshotIntervalMin}m snapshots)</strong>
                </div>
                <div className="sb-summary-item">
                  <span>Total Output Snapshots:</span>
                  <strong>{Math.floor((durationHours * 60) / snapshotIntervalMin) + 1} frames</strong>
                </div>
              </div>

              {/* Validation Feedback */}
              {validationResult && (
                <div className={`sb-validation-box ${validationResult.valid ? "valid" : "invalid"}`}>
                  {validationResult.valid ? (
                    <div className="sb-val-ok">
                      <IconCheck /> All parameters physically valid & within DEM AOI bounds.
                    </div>
                  ) : (
                    <div className="sb-val-errors">
                      <strong>Validation Errors:</strong>
                      <ul>
                        {validationResult.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {validationResult.warnings && validationResult.warnings.length > 0 && (
                    <div className="sb-val-warnings">
                      <strong>Notes:</strong>
                      <ul>
                        {validationResult.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {error && <div className="sb-error-box">{error}</div>}

              {/* Honest Execution Tracker */}
              {jobStatus !== "idle" && (
                <div className={`sb-status-box status-${jobStatus}`}>
                  <div className="sb-status-header">
                    <span className="sb-status-dot" />
                    <strong>Status: {jobStatus.toUpperCase()}</strong>
                  </div>
                  <p className="sb-status-msg">{statusMessage}</p>
                </div>
              )}

              {/* Actions */}
              <div className="sb-actions">
                <button
                  className="sb-run-btn"
                  onClick={handleRunSimulation}
                  disabled={jobStatus === "running" || jobStatus === "processing" || jobStatus === "queued"}
                >
                  {jobStatus === "running" || jobStatus === "processing" || jobStatus === "queued"
                    ? "Running Simulation…"
                    : "🚀 Run Simulation Pipeline"}
                </button>

                {jobStatus === "complete" && (
                  <div className="sb-completed-actions">
                    <button
                      className="sb-view-btn primary"
                      onClick={() => {
                        if (onScenarioSelect) onScenarioSelect(scenarioId);
                        if (onEnterView) onEnterView("full");
                      }}
                    >
                      🗺️ Open 2D Map & Timeline <IconArrowRight />
                    </button>
                    <button
                      className="sb-view-btn"
                      onClick={() => {
                        if (onScenarioSelect) onScenarioSelect(scenarioId);
                        if (onEnterView) onEnterView("full");
                      }}
                    >
                      🌐 View 3D Cesium Terrain
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Available Scenario Runs History */}
          <div className="sb-card" style={{ marginTop: "16px" }}>
            <div className="sb-card-header">
              <h3>Available Scenario Runs</h3>
              <span className="subtle">{existingRuns.length} runs</span>
            </div>
            <div className="sb-card-body">
              {existingRuns.length === 0 ? (
                <p className="subtle">No runs available yet.</p>
              ) : (
                <div className="sb-runs-list">
                  {existingRuns.map((r) => {
                    const isActive = activeJobId === r.job_id;
                    return (
                      <div
                        key={r.job_id}
                        className={`sb-run-item ${isActive ? "active" : ""}`}
                        onClick={() => handleLoadExistingRun(r.job_id)}
                      >
                        <div className="sb-run-title">
                          <strong>{r.scenario_label}</strong>
                          {isActive && <span className="sb-active-tag">Active</span>}
                        </div>
                        <div className="sb-run-meta">
                          <span>{Number(r.discharge_cumecs).toLocaleString()} m³/s</span>
                          <span>·</span>
                          <span>{r.duration_hours}h duration</span>
                          <span>·</span>
                          <span>{r.max_flooded_area_km2} km² max extent</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
