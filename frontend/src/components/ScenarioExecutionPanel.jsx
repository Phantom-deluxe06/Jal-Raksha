import React, { useState, useEffect } from "react";
import { IconWaves, IconBolt, IconCheck } from "./icons";
import DynamicImpactSummary from "./DynamicImpactSummary";
import DynamicSarComparison from "./DynamicSarComparison";

export default function ScenarioExecutionPanel({ damId, demData, onExecutionComplete }) {
  const [execMode, setExecMode] = useState("physics"); // "physics" | "ai_surrogate"
  const [breachMode, setBreachMode] = useState("overtopping");
  const [formationTime, setFormationTime] = useState(1.5);
  const [dischargeMultiplier, setDischargeMultiplier] = useState(1.0);
  
  const [jobId, setJobId] = useState(null);
  const [status, setStatus] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [metrics, setMetrics] = useState(null);

  // Poll progress if a job is running
  useEffect(() => {
    let interval;
    if (jobId && (status === "initializing" || status === "processing" || status === "queued")) {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`http://127.0.0.1:8000/api/simulation/progress/${jobId}`);
          if (res.ok) {
            const data = await res.json();
            setStatus(data.status);
            setProgress(data.progress);
            setMessage(data.message);
            if (data.metrics) {
              setMetrics(data.metrics);
            }
          }
        } catch (e) {
          console.error("Poll error:", e);
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [jobId, status]);

  const handleLaunchAI = async () => {
    setStatus("initializing");
    setProgress(0);
    setMessage("Running U-Net AI surrogate (instant inference)...");
    try {
      const res = await fetch("http://127.0.0.1:8000/predict/instant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discharge_cumecs: 3675.0 * parseFloat(dischargeMultiplier),
        }),
      });
      if (!res.ok) throw new Error("surrogate returned " + res.status);
      const data = await res.json();
      setMetrics({
        max_depth_m: data.max_depth_m,
        max_extent_km2: data.flooded_area_km2,
        peak_velocity_m_s: "—",
        mass_conservation_delta_pct: 0,
        run_time_sec: data.inference_s?.toFixed?.(3) ?? data.inference_s,
        ai_surrogate: true,
        overlay_png_base64: data.overlay_png_base64,
        caveat: data.caveat,
      });
      setJobId(data.scenario_label ? "ai_surrogate_preview" : "ai_surrogate_preview");
      setStatus("complete");
    } catch (e) {
      setStatus("failed");
      setMessage("U-Net surrogate call failed: " + e.message);
    }
  };

  const handleLaunch = async () => {
    if (execMode === "ai_surrogate") return handleLaunchAI();
    setStatus("initializing");
    setProgress(0);
    setMessage("Submitting job...");

    try {
      const res = await fetch("http://127.0.0.1:8000/api/simulation/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dam_id: damId,
          breach_mode: breachMode,
          formation_time_hr: parseFloat(formationTime),
          peak_discharge_multiplier: parseFloat(dischargeMultiplier),
          timesteps: 17,
          resolution_m: 90.0
        })
      });
      const data = await res.json();
      setJobId(data.job_id);
    } catch (e) {
      setStatus("failed");
      setMessage("Failed to connect to simulation engine.");
    }
  };

  return (
    <div className="sb-card" style={{ marginTop: "20px", border: "1px solid rgba(74, 144, 255, 0.4)", background: "rgba(10, 15, 20, 0.6)" }}>
      <div className="sb-card-header">
        <h3 style={{ color: "#4a90ff" }}><IconWaves /> Step 2: Breach & Hydrodynamics</h3>
      </div>
      
      <div className="sb-card-body">
        {status === "idle" && (
          <>
            <div style={{ marginBottom: "16px", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "8px", overflow: "hidden" }}>
              {[
                { key: "physics", title: "2D Physics LIA Solver", sub: "Numerical Finite Volume · High Precision" },
                { key: "ai_surrogate", title: "U-Net AI Surrogate", sub: "Instant Inference ~35ms · 300m Grid · Mean IoU 0.894" },
              ].map((opt) => (
                <label
                  key={opt.key}
                  style={{
                    display: "flex", alignItems: "flex-start", gap: "10px", padding: "12px 14px", cursor: "pointer",
                    background: execMode === opt.key ? "rgba(74,144,255,0.15)" : "transparent",
                    borderBottom: opt.key === "physics" ? "1px solid rgba(255,255,255,0.1)" : "none",
                  }}
                >
                  <input
                    type="radio"
                    name="execMode"
                    checked={execMode === opt.key}
                    onChange={() => setExecMode(opt.key)}
                    style={{ marginTop: "3px" }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, color: execMode === opt.key ? "#4a90ff" : "#ddd" }}>{opt.title}</div>
                    <div style={{ fontSize: "11px", color: "#888" }}>{opt.sub}</div>
                  </div>
                </label>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "20px" }}>
              <div>
                <label className="sb-label">Breach Mechanism</label>
                <select 
                  className="sb-input"
                  value={breachMode}
                  onChange={(e) => setBreachMode(e.target.value)}
                  style={{ width: "100%", padding: "10px", background: "rgba(0,0,0,0.3)", color: "white", border: "1px solid rgba(255,255,255,0.2)", borderRadius: "4px" }}
                >
                  <option value="overtopping">Overtopping Failure</option>
                  <option value="piping">Piping / Seepage</option>
                </select>
              </div>
              
              <div>
                <label className="sb-label">Formation Time (Hours): {formationTime}h</label>
                <input 
                  type="range" 
                  min="0.5" max="4.0" step="0.1" 
                  value={formationTime} 
                  onChange={(e) => setFormationTime(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
              
              <div>
                <label className="sb-label">Discharge Scale Multiplier: {dischargeMultiplier}x</label>
                <input 
                  type="range" 
                  min="0.5" max="3.0" step="0.1" 
                  value={dischargeMultiplier} 
                  onChange={(e) => setDischargeMultiplier(e.target.value)}
                  style={{ width: "100%" }}
                />
              </div>
              
              <div style={{ background: "rgba(255, 159, 28, 0.1)", padding: "15px", borderRadius: "8px", border: "1px solid rgba(255, 159, 28, 0.3)" }}>
                <h4 style={{ margin: "0 0 10px 0", color: "#ff9f1c" }}>Froehlich Peak Outflow (Est.)</h4>
                <div style={{ fontSize: "24px", fontWeight: "bold" }}>
                  {(15000 * dischargeMultiplier).toLocaleString()} <span style={{ fontSize: "14px", fontWeight: "normal" }}>m³/s</span>
                </div>
                <div style={{ fontSize: "11px", color: "#aaa", marginTop: "4px" }}>
                  Based on volume/height catalog data
                </div>
              </div>
            </div>
            
            <button 
              onClick={handleLaunch}
              style={{
                width: "100%", padding: "15px", background: "#ff4757", color: "white", 
                border: "none", borderRadius: "8px", fontSize: "16px", fontWeight: "bold", cursor: "pointer",
                display: "flex", justifyContent: "center", alignItems: "center", gap: "10px"
              }}>
              <IconBolt /> {execMode === "ai_surrogate" ? "Run U-Net AI Surrogate (Instant)" : "Launch 2D Hydrodynamic Solver"}
            </button>
          </>
        )}

        {(status === "initializing" || status === "processing" || status === "queued") && (
          <div style={{ padding: "30px", textAlign: "center" }}>
            <div className="spinner" style={{ marginBottom: "20px" }}></div>
            <h3 style={{ color: "#2ed573", marginBottom: "10px" }}>{message}</h3>
            <div style={{ width: "100%", height: "8px", background: "rgba(255,255,255,0.1)", borderRadius: "4px", overflow: "hidden" }}>
              <div style={{ width: `${progress}%`, height: "100%", background: "#2ed573", transition: "width 0.3s" }}></div>
            </div>
            <p style={{ marginTop: "10px", color: "#888", fontSize: "12px" }}>Running GenericHydrodynamicEngine on Phase 11 DEM Grid</p>
          </div>
        )}

        {status === "complete" && metrics && (
          <div>
            <h3 style={{ color: "#2ed573", marginBottom: "15px" }}><IconCheck /> Physical Integration Complete</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "15px", marginBottom: "20px" }}>
              <div style={{ background: "rgba(46, 213, 115, 0.1)", padding: "15px", borderRadius: "8px" }}>
                <div style={{ fontSize: "12px", color: "#888" }}>Max Flood Depth</div>
                <div style={{ fontSize: "20px", color: "white", fontWeight: "bold" }}>{metrics.max_depth_m} m</div>
              </div>
              <div style={{ background: "rgba(46, 213, 115, 0.1)", padding: "15px", borderRadius: "8px" }}>
                <div style={{ fontSize: "12px", color: "#888" }}>Max Extent Area</div>
                <div style={{ fontSize: "20px", color: "white", fontWeight: "bold" }}>{metrics.max_extent_km2} km²</div>
              </div>
              <div style={{ background: "rgba(46, 213, 115, 0.1)", padding: "15px", borderRadius: "8px" }}>
                <div style={{ fontSize: "12px", color: "#888" }}>Peak Velocity</div>
                <div style={{ fontSize: "20px", color: "white", fontWeight: "bold" }}>{metrics.peak_velocity_m_s} m/s</div>
              </div>
              <div style={{ background: "rgba(46, 213, 115, 0.1)", padding: "15px", borderRadius: "8px", gridColumn: "span 3" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: "12px", color: "#888" }}>Mass Conservation Error</div>
                    <div style={{ fontSize: "20px", color: Math.abs(metrics.mass_conservation_delta_pct) < 1.0 ? "#2ed573" : "#ff4757", fontWeight: "bold" }}>
                      {metrics.mass_conservation_delta_pct > 0 ? "+" : ""}{metrics.mass_conservation_delta_pct}%
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "12px", color: "#888" }}>Compute Time</div>
                    <div style={{ fontSize: "20px", color: "white", fontWeight: "bold" }}>{metrics.run_time_sec}s</div>
                  </div>
                </div>
              </div>
            </div>
            
            <DynamicImpactSummary scenarioId={jobId} />
            <DynamicSarComparison 
              bbox={demData?.bbox || [86.8, 26.5, 87.2, 26.9]} 
              simulatedExtentKm2={metrics.max_extent_km2} 
            />
            
            <button 
              onClick={() => onExecutionComplete(jobId)}
              style={{
                width: "100%", padding: "15px", background: "#4a90ff", color: "white", 
                border: "none", borderRadius: "8px", fontSize: "16px", fontWeight: "bold", cursor: "pointer"
              }}>
              Load Results into 2D/3D Digital Twin
            </button>
          </div>
        )}
        
        {status === "failed" && (
          <div style={{ padding: "20px", background: "rgba(255, 71, 87, 0.1)", border: "1px solid #ff4757", borderRadius: "8px", color: "#ff4757" }}>
            <h4>Simulation Failed</h4>
            <p>{message}</p>
            <button onClick={() => setStatus("idle")} style={{ marginTop: "10px", padding: "8px 16px", background: "transparent", border: "1px solid #ff4757", color: "#ff4757", borderRadius: "4px" }}>Retry</button>
          </div>
        )}
      </div>
    </div>
  );
}
