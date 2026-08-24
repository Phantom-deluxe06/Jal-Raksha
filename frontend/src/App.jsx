import { useEffect, useState } from "react";
import FloodMap from "./components/FloodMap";
import Timeline from "./components/Timeline";
import Legend from "./components/Legend";
import InfoPanel from "./components/InfoPanel";
import PredictionControls from "./components/PredictionControls";
import { fetchResult, frameUrl, triggerRun } from "./api";
import "./App.css";

export default function App() {
  const [meta, setMeta] = useState(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState("full"); // "full" | "instant"
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
      : prediction
        ? `data:image/png;base64,${prediction.overlay_png_base64}`
        : null;

  return (
    <div className="app-root">
      <div className="map-pane">
        <FloodMap
          bounds={mode === "instant" && prediction ? prediction.bounds : meta.bounds}
          overlayUrl={overlayUrl}
          overlayKey={mode === "full" ? frame.overlay_png : prediction?.inference_s + String(predictedLocation)}
          breachLatLon={meta.breach_latlon}
          predictedLocation={mode === "instant" ? predictedLocation : null}
        />
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
        </div>

        {mode === "full" ? (
          <InfoPanel meta={meta} onRerun={handleRerun} running={running} />
        ) : (
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
      </div>
    </div>
  );
}
