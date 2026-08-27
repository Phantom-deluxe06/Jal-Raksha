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
import { fetchResult, frameUrl, triggerRun, queryPointDepth } from "./api";
import "./App.css";

const MAP_MODES = new Set(["full", "instant", "realtime"]);

export default function App() {
  const [meta, setMeta] = useState(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState("overview"); // "overview" | "full" | "instant" | "sph" | "twin" | "realtime"
  const [viewMode, setViewMode] = useState("2d"); // "2d" | "3d"
  const [prediction, setPrediction] = useState(null);
  const [predictedLocation, setPredictedLocation] = useState(null);
  const [realtimeData, setRealtimeData] = useState(null);

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

  const load = () => {
    fetchResult().then(setMeta).catch((e) => setError(e.message));
  };

  useEffect(load, []);

  const handleRerun = async () => {
    setRunning(true);
    setError(null);
    try {
      await triggerRun();
      load();
      if (selectedPoint) {
        handlePointClick(selectedPoint);
      }
    } catch (e) {
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

  if (error) {
    return (
      <div className="error-screen">
        <h2>Could not reach the simulation backend</h2>
        <p>{error}</p>
        <p>Is the FastAPI server running? <code>uvicorn backend.main:app --port 8000</code></p>
      </div>
    );
  }

  if (!meta) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Loading simulation results…</p>
      </div>
    );
  }

  const frame = meta.frames[frameIndex];
  const overlayUrl =
    mode === "full" || mode === "realtime"
      ? frameUrl(frame.overlay_png)
      : mode === "instant" && prediction
        ? `data:image/png;base64,${prediction.overlay_png_base64}`
        : null;

  const activeBounds = mode === "instant" && prediction ? prediction.bounds : meta.bounds;
  const showMap = MAP_MODES.has(mode);

  return (
    <div className="app-shell">
      <SideNav mode={mode} setMode={setMode} />

      <div className="app-main">
        {mode === "overview" ? (
          <Overview key="overview" meta={meta} onEnter={setMode} />
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
                    overlayKey={mode === "full" || mode === "realtime" ? frame.overlay_png : prediction?.inference_s + String(predictedLocation)}
                    breachLatLon={meta.breach_latlon}
                    predictedLocation={mode === "instant" ? predictedLocation : null}
                    realtimeExtent={mode === "realtime" ? realtimeData : null}
                    sarComparison={mode === "realtime" ? sarComparison : null}
                    sarLayers={mode === "realtime" ? sarLayers : { showSim: true, showSar: false, showDiff: false, baseSatellite: false }}
                    onPointClick={mode === "full" ? handlePointClick : undefined}
                    selectedPoint={selectedPoint}
                    selectedPointData={selectedPointData}
                    loadingPoint={loadingPoint}
                    frameIndex={frameIndex}
                  />
                ) : (
                  <CesiumViewer
                    bounds={activeBounds}
                    frames={meta.frames}
                    frameIndex={frameIndex}
                  />
                )}
                {(mode === "full" || mode === "instant") && <Legend />}
                {(mode === "full" || mode === "realtime") && (
                  <Timeline frames={meta.frames} index={frameIndex} onChange={setFrameIndex} />
                )}
              </div>
            )}

            <div className={showMap ? "side-panel" : "dashboard-panel"}>
              {mode === "full" && (
                <InfoPanel
                  meta={meta}
                  frame={frame}
                  onRerun={handleRerun}
                  running={running}
                  selectedPointData={selectedPointData}
                  loadingPoint={loadingPoint}
                  frameIndex={frameIndex}
                  onSelectTimestep={setFrameIndex}
                  onClearPoint={handleClearPoint}
                />
              )}
              {mode === "instant" && (
                <PredictionControls
                  baseDischarge={meta.discharge_cumecs}
                  baseLat={meta.breach_latlon.lat}
                  baseLon={meta.breach_latlon.lon}
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
                  onData={setRealtimeData}
                  onComparisonChange={setSarComparison}
                  sarLayers={sarLayers}
                  setSarLayers={setSarLayers}
                  frameIndex={frameIndex}
                  frames={meta.frames}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
