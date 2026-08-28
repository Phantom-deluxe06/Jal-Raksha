import React from "react";

export default function InspectionPanel({ pickedData, hydraulics, onClose }) {
  if (!pickedData) return null;

  const { isEntity, type, metadata, lat, lon } = pickedData;
  const { depth, velocity } = hydraulics;

  let statusText = "Safe";
  let statusColor = "#4cd137";
  if (depth >= 0.3) {
    statusText = "Submerged";
    statusColor = "#e84118";
  } else if (depth >= 0.1) {
    statusText = "At Risk";
    statusColor = "#fbc531";
  }

  const isSettlement = type === "settlement";

  return (
    <div
      style={{
        position: "absolute",
        top: 20,
        right: 280, // Next to the sidebar controls
        zIndex: 1000,
        width: "300px",
        background: "rgba(20, 25, 30, 0.9)",
        backdropFilter: "blur(8px)",
        border: `1px solid ${statusColor}`,
        borderRadius: "12px",
        color: "white",
        boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
        overflow: "hidden",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          background: "rgba(255, 255, 255, 0.05)",
          padding: "12px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <span style={{ fontSize: "12px", textTransform: "uppercase", fontWeight: "bold", color: "#aaa" }}>
          {isSettlement ? "Settlement Profile" : "Terrain Probe"}
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#aaa",
            cursor: "pointer",
            fontSize: "16px",
          }}
        >
          &times;
        </button>
      </div>

      <div style={{ padding: "16px" }}>
        <h3 style={{ margin: "0 0 4px 0", fontSize: "18px", color: "white" }}>
          {metadata.name || "Unknown"}
        </h3>
        <div style={{ fontSize: "12px", color: "#888", marginBottom: "16px" }}>
          Lat: {lat.toFixed(5)}°, Lon: {lon.toFixed(5)}°
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#aaa", fontSize: "14px" }}>Status</span>
            <span
              style={{
                background: statusColor,
                color: depth >= 0.3 ? "white" : "black",
                padding: "2px 8px",
                borderRadius: "12px",
                fontSize: "12px",
                fontWeight: "bold",
              }}
            >
              {statusText}
            </span>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#aaa", fontSize: "14px" }}>Water Depth</span>
            <strong style={{ fontSize: "16px" }}>{depth.toFixed(2)} m</strong>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#aaa", fontSize: "14px" }}>Flow Velocity</span>
            <strong style={{ fontSize: "16px" }}>{velocity.toFixed(2)} m/s</strong>
          </div>

          {isSettlement && (
            <>
              <div style={{ height: "1px", background: "rgba(255,255,255,0.1)", margin: "4px 0" }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "#aaa", fontSize: "14px" }}>Baseline Population</span>
                <strong style={{ fontSize: "14px", color: depth >= 0.1 ? "#e84118" : "white" }}>
                  {metadata.population ? metadata.population.toLocaleString() : "N/A"}
                </strong>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
