import React, { useState, useEffect } from "react";
import { IconBolt, IconCheck } from "./icons"; // Assume basic icons

export default function DemPreviewPanel({ demData, damId, onContinue }) {
  const [viewMode, setViewMode] = useState("hillshade"); // 'hillshade' or 'contour'

  if (!demData) {
    return (
      <div className="sb-card" style={{ marginTop: "20px", border: "1px solid rgba(74, 144, 255, 0.4)", animation: "pulse 2s infinite" }}>
        <div className="sb-card-body" style={{ textAlign: "center", padding: "40px 20px" }}>
          <div className="spinner" style={{ marginBottom: "16px" }}></div>
          <h3 style={{ color: "#4a90ff", marginBottom: "8px" }}>[1/3] Fetching 30m DEM & Terrain Bathymetry...</h3>
          <p className="subtle">Contacting Copernicus GLO-30 Open STAC...</p>
          <div style={{ marginTop: "16px", fontSize: "12px", color: "#888" }}>Clipping target area to high-resolution hydrodynamic mesh</div>
        </div>
      </div>
    );
  }

  return (
    <div className="sb-card" style={{ marginTop: "20px", border: "1px solid rgba(74, 144, 255, 0.4)", background: "rgba(10, 15, 20, 0.6)" }}>
      <div className="sb-card-header">
        <h3 style={{ color: "#4a90ff" }}><IconCheck /> Terrain Ingestion Complete</h3>
        <span className="sb-param-tag">Ready for SWE Solver</span>
      </div>
      <div className="sb-card-body">
        <div style={{ display: "flex", gap: "20px" }}>
          {/* Left: Preview Image */}
          <div style={{ flex: "0 0 300px" }}>
            <div style={{ 
              width: "300px", 
              height: "300px", 
              background: "#111", 
              borderRadius: "8px", 
              overflow: "hidden", 
              position: "relative",
              border: "1px solid rgba(255,255,255,0.1)"
            }}>
              <img 
                src={`http://127.0.0.1:8000${demData.preview_png_url}`} 
                alt="DEM Hillshade" 
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
              <div style={{ position: "absolute", bottom: "8px", left: "8px", background: "rgba(0,0,0,0.7)", padding: "4px 8px", borderRadius: "4px", fontSize: "11px", color: "#ccc" }}>
                {demData.source}
              </div>
            </div>
          </div>
          
          {/* Right: Metrics & Controls */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "20px" }}>
              <div style={{ background: "rgba(255,255,255,0.05)", padding: "12px", borderRadius: "8px" }}>
                <div style={{ fontSize: "12px", color: "#888", marginBottom: "4px" }}>Elevation Range</div>
                <div style={{ fontSize: "16px", color: "white", fontWeight: "bold" }}>
                  {demData.min_elevation_m}m - {demData.max_elevation_m}m
                </div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.05)", padding: "12px", borderRadius: "8px" }}>
                <div style={{ fontSize: "12px", color: "#888", marginBottom: "4px" }}>Mean Slope</div>
                <div style={{ fontSize: "16px", color: "white", fontWeight: "bold" }}>
                  {demData.mean_slope_deg}°
                </div>
              </div>
              <div style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.2)", padding: "10px", borderRadius: "4px" }}>
                <div style={{ fontSize: "12px", color: "#888", marginBottom: "4px" }}>Grid Shape</div>
                <div style={{ fontSize: "16px", color: "white", fontWeight: "bold", fontFamily: "monospace" }}>
                  {demData.grid_shape?.[0] ?? "?"} × {demData.grid_shape?.[1] ?? "?"}
                </div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.05)", padding: "12px", borderRadius: "8px" }}>
                <div style={{ fontSize: "12px", color: "#888", marginBottom: "4px" }}>Status</div>
                <div style={{ fontSize: "16px", color: demData.status === "fallback_to_kosi" ? "#ff9f1c" : "#2ed573", fontWeight: "bold", textTransform: "capitalize" }}>
                  {demData.status.replace(/_/g, ' ')}
                </div>
              </div>
            </div>

            <div style={{ fontSize: "13px", color: "#aaa", marginBottom: "20px", flex: 1 }}>
              <p>Raw Source: Copernicus GLO-30</p>
              <p>Compute Grid: 90m (Bilinear Resampled)</p>
              <p>Manning's Roughness (n): 0.035 (Base Riverbed)</p>
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button 
                onClick={onContinue}
                style={{
                  padding: "12px 24px",
                  background: "#4a90ff",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  fontWeight: "bold",
                  cursor: "pointer",
                  flex: 1
                }}>
                Proceed to Hydrodynamic Simulation
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
