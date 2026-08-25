import { useEffect, useState } from "react";
import FloodMap from "./components/FloodMap";
import Terrain3D from "./components/Terrain3D";
import Timeline from "./components/Timeline";
import Legend from "./components/Legend";
import InfoPanel from "./components/InfoPanel";
import PredictionControls from "./components/PredictionControls";
import SphComparison from "./components/SphComparison";
import LiveTwin from "./components/LiveTwin";
import { fetchResult, frameUrl, triggerRun } from "./api";
import "./App.css";

export default function App() {
  const [meta, setMeta] = useState(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState("full"); // "full" | "instant" | "sph" | "twin"
  const [viewMode, setViewMode] = useState("2d"); // "2d" | "3d"
  const [prediction, setPrediction] = useState(null);
  const [predictedLocation, setPredictedLocation] = useState(null);

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
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
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

  if (!meta) return <div className="loading-screen">Loading simulation results…</div>;

  const frame = meta.frames[frameIndex];
  const overlayUrl =
    mode === "full"
      ? frameUrl(frame.overlay_png)
      : mode === "instant" && prediction
        ? `data:image/png;base64,${prediction.overlay_png_base64}`
        : null;

  const activeBounds = mode === "instant" && prediction ? prediction.bounds : meta.bounds;

  return (
    <div className="app-root">
      <div className="map-pane">
        {/* 2D / 3D View Switcher */}
        <div className="viewport-toggle">
          <button
            className={viewMode === "2d" ? "active" : ""}
            onClick={() => setViewMode("2d")}
          >
            🗺️ 2D Map View
          </button>
          <button
            className={viewMode === "3d" ? "active" : ""}
            onClick={() => setViewMode("3d")}
          >
            🌐 3D Terrain (SRTM + S2)
          </button>
        </div>

        {viewMode === "2d" ? (
          <FloodMap
            bounds={activeBounds}
            overlayUrl={overlayUrl}
            overlayKey={mode === "full" ? frame.overlay_png : prediction?.inference_s + String(predictedLocation)}
            breachLatLon={meta.breach_latlon}
            predictedLocation={mode === "instant" ? predictedLocation : null}
          />
        ) : (
          <Terrain3D
            bounds={activeBounds}
            overlayUrl={overlayUrl}
            breachLatLon={meta.breach_latlon}
            currentTimeFormatted={frame ? `T+${frame.t_minutes}m` : "T+0m"}
            mode={mode}
          />
        )}

        <Legend />
        {mode === "full" && <Timeline frames={meta.frames} index={frameIndex} onChange={setFrameIndex} />}
      </div>
      <div className="side-panel">
        <div className="mode-toggle">
          <button className={mode === "full" ? "active" : ""} onClick={() => setMode("full")}>
            Full SWE Simulation
          </button>
          <button className={mode === "instant" ? "active" : ""} onClick={() => setMode("instant")}>
            Instant AI Prediction
          </button>
          <button className={mode === "sph" ? "active" : ""} onClick={() => setMode("sph")}>
            SPH Comparison
          </button>
          <button className={mode === "twin" ? "active" : ""} onClick={() => setMode("twin")}>
            Live Twin
          </button>
        </div>

        {mode === "full" && <InfoPanel meta={meta} onRerun={handleRerun} running={running} />}
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
      </div>
    </div>
  );
}

