import { useEffect, useState } from "react";
import FloodMap from "./components/FloodMap";
import CesiumViewer from "./components/CesiumViewer";
import Timeline from "./components/Timeline";
import Legend from "./components/Legend";
import InfoPanel from "./components/InfoPanel";
import PredictionControls from "./components/PredictionControls";
import SphComparison from "./components/SphComparison";
import LiveTwin from "./components/LiveTwin";
import RealtimeSar from "./components/RealtimeSar";
import SideNav from "./components/SideNav";
import Overview from "./components/Overview";
import { fetchResult, frameUrl, triggerRun, queryPointDepth, fetchImpactAnalysis, DEFAULT_JOB_ID } from "./api";
import ScenarioBuilder from "./components/ScenarioBuilder";
import ImpactDashboard from "./components/ImpactDashboard";import "./App.css";

const MAP_MODES = new Set(["full", "instant", "realtime"]);

export default function App() {
  const [activeJobId, setActiveJobId] = useState(DEFAULT_JOB_ID);
  const [meta, setMeta] = useState(null);
  const [impactData, setImpactData] = useState(null);
  const [selectedSettlement, setSelectedSettlement] = useState(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState("overview"); // "overview" | "builder" | "full" | "impact" | "instant" | "sph" | "twin" | "realtime"
  const [viewMode, setViewMode] = useState("2d"); // "2d" | "3d"
  const [prediction, setPrediction] = useState(null);
  const [predictedLocation, setPredictedLocation] = useState(null);
  const [realtimeData, setRealtimeData] = useState(null);
  const [sarDifferenceData, setSarDifferenceData] = useState(null);

  // Point Inspection State
  const [selectedPoint, setSelectedPoint] = useState(null);
  const [selectedPointData, setSelectedPointData] = useState(null);
  const [loadingPoint, setLoadingPoint] = useState(false);

  // Real-Time SAR Validation State
  const [sarComparison, setSarComparison] = useState(null);
  const [sarLayers, setSarLayers] = useState({
    showSim: true,
    showSar: true,
    showDiff: false,
    baseSatellite: false,
  });

  const load = (jobId = activeJobId) => {
    fetchResult(jobId)
      .then((data) => {
        setMeta(data);
        setFrameIndex(0);
        setError(null);
        // Load impact data
        fetchImpactAnalysis(jobId)
          .then(setImpactData)
          .catch((err) => console.warn("Impact analysis note:", err.message));
      })
      .catch((e) => setError(e.message));  };

  useEffect(() => {
    load(activeJobId);
  }, [activeJobId]);

  const handleRerun = async () => {
    setRunning(true);
    setError(null);
    try {
      await triggerRun();
      load(activeJobId);
      if (selectedPoint) {
        handlePointClick(selectedPoint);
      }    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  };

  const handlePointClick = async ({ lat, lon }) => {
    setSelectedPoint({ lat, lon });
    setLoadingPoint(true);
    try {
      const data = await queryPointDepth(lat, lon);
      setSelectedPointData(data);
    } catch (e) {
      console.error("Point query failed:", e);
      setSelectedPointData({
        in_bounds: false,
        lat,
        lon,
        message: e.message || "Failed to query simulation grid",
      });
    } finally {
      setLoadingPoint(false);
    }
  };

  const handleClearPoint = () => {
    setSelectedPoint(null);
    setSelectedPointData(null);
  };
  const handleScenarioSelect = (newJobId) => {
    setActiveJobId(newJobId);  };

  if (error) {
    return (
      <div className="error-screen">
        <h2>Could not reach the simulation backend</h2>
        <p>{error}</p>
        <p>Is the FastAPI server running? <code>uvicorn backend.main:app --port 8000</code></p>
        <button className="chip-btn" onClick={() => load(activeJobId)} style={{ marginTop: "12px" }}>
          Retry Connection
        </button>
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Loading simulation scenario ({activeJobId})…</p>
      </div>
    );
  }

  const frame = meta.frames && meta.frames.length > frameIndex ? meta.frames[frameIndex] : meta.frames[0];
  const overlayUrl =
    (mode === "full" || mode === "realtime") && frame
      ? frameUrl(frame.overlay_png, activeJobId)      : mode === "instant" && prediction
        ? `data:image/png;base64,${prediction.overlay_png_base64}`
        : null;

  const activeBounds = mode === "instant" && prediction ? prediction.bounds : meta.bounds;
  const showMap = MAP_MODES.has(mode);

  // Settlement list formatted for current frame
  const settlementsForMap = (impactData?.settlements || []).map((s) => {
    const depthObj = s.depth_time_series && s.depth_time_series[frameIndex];
    return {
      ...s,
      current_depth_m: depthObj ? depthObj.depth_m : 0.0,
      is_exposed_current: depthObj ? depthObj.depth_m >= 0.1 : false,
    };
  });

  return (
    <div className="app-shell">
      <SideNav mode={mode} setMode={setMode} />

      <div className="app-main">
        {mode === "overview" ? (
          <Overview key="overview" meta={meta} onEnter={setMode} />
        ) : mode === "builder" ? (
          <ScenarioBuilder
            key="builder"
            activeJobId={activeJobId}
            onScenarioSelect={handleScenarioSelect}
            onEnterView={setMode}
          />
        ) : mode === "impact" ? (
          <ImpactDashboard
            key="impact"
            jobId={activeJobId}
            meta={meta}
            frameIndex={frameIndex}
            onSelectSettlement={(s) => setSelectedSettlement(s)}
            onEnterView={setMode}
          />
        ) : (
          <div key={mode} className={`workspace ${showMap ? "workspace-map" : "workspace-dashboard"}`}>
            {showMap && (
              <div className="map-pane">
                <div className="viewport-toggle">
                  <button
                    className={viewMode === "2d" ? "active" : ""}
                    onClick={() => setViewMode("2d")}
                  >
                    🗺️ 2D Map
                  </button>
                  <button
                    className={viewMode === "3d" ? "active" : ""}
                    onClick={() => setViewMode("3d")}
                  >
                    🌐 3D Terrain
                  </button>
                </div>

                {viewMode === "2d" ? (
                  <FloodMap
                    bounds={activeBounds}
                    overlayUrl={overlayUrl}
                    overlayKey={mode === "full" || mode === "realtime" ? (frame?.overlay_png + activeJobId) : (prediction?.inference_s + String(predictedLocation))}
                    breachLatLon={meta.breach_latlon}
                    predictedLocation={mode === "instant" ? predictedLocation : null}
                    realtimeExtent={mode === "realtime" ? realtimeData : null}
                    sarDifferenceExtent={mode === "realtime" ? sarDifferenceData : null}
                    sarComparison={mode === "realtime" ? sarComparison : null}
                    sarLayers={mode === "realtime" ? sarLayers : { showSim: true, showSar: false, showDiff: false, baseSatellite: false }}
                    onPointClick={mode === "full" ? handlePointClick : undefined}
                    selectedPoint={selectedPoint}
                    selectedPointData={selectedPointData}
                    loadingPoint={loadingPoint}
                    frameIndex={frameIndex}
                    settlements={settlementsForMap}
                    selectedSettlement={selectedSettlement}
                    onSelectSettlement={setSelectedSettlement}
                    showSettlements={mode === "full"}
                    allowLayerToggles={true}                  />
                ) : (
                  <CesiumViewer
                    bounds={activeBounds}
                    frames={meta.frames}
                    frameIndex={frameIndex}
                    jobId={activeJobId}
                  />
                )}
                {(mode === "full" || mode === "instant") && <Legend />}
                {mode === "full" && meta.frames && (                  <Timeline frames={meta.frames} index={frameIndex} onChange={setFrameIndex} />
                )}
              </div>
            )}

            <div className={showMap ? "side-panel" : "dashboard-panel"}>
              {mode === "full" && (
                <InfoPanel
                  meta={meta}
                  frame={frame}
                  jobId={activeJobId}
                  onRerun={handleRerun}
                  running={running}
                  onOpenBuilder={() => setMode("builder")}
                  selectedPointData={selectedPointData}
                  loadingPoint={loadingPoint}
                  frameIndex={frameIndex}
                  onSelectTimestep={setFrameIndex}
                  onClearPoint={handleClearPoint}                />
              )}
              {mode === "instant" && (
                <PredictionControls
                  baseDischarge={meta.discharge_cumecs || 3675}
                  baseLat={meta.breach_latlon?.lat || 26.62}
                  baseLon={meta.breach_latlon?.lon || 87.05}
                  onResult={(result, loc) => {
                    setPrediction(result);
                    setPredictedLocation(loc);
                  }}
                />
              )}
              {mode === "sph" && <SphComparison />}
              {mode === "twin" && <LiveTwin />}
              {mode === "realtime" && (
                <RealtimeSar
                  jobId={activeJobId}
                  meta={meta}
                  frameIndex={frameIndex}
                  frames={meta.frames}
                  onData={setRealtimeData}
                  onDifferenceData={setSarDifferenceData}
                  onComparisonChange={setSarComparison}
                  sarLayers={sarLayers}
                  setSarLayers={setSarLayers}                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

