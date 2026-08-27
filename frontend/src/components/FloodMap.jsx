import { useEffect, useState } from "react";
import { MapContainer, TileLayer, ImageOverlay, GeoJSON, Marker, Popup, ZoomControl, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { satelliteUrl } from "../api";

const breachIcon = new L.DivIcon({
  className: "breach-marker",
  html: '<div style="width:14px;height:14px;border-radius:50%;background:#ff3b30;border:2px solid white;box-shadow:0 0 6px rgba(0,0,0,0.8);"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const barrageIcon = new L.DivIcon({
  className: "barrage-marker",
  html: '<div style="width:12px;height:12px;background:#333;border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,0.6);"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

const createSettlementIcon = (isExposed, isSignificant, isSelected) => {
  let color = "#aaaaaa";
  let size = 8;
  let border = "1px solid rgba(0,0,0,0.5)";
  let pulse = "";

  if (isSelected) {
    color = "#f1c40f";
    size = 14;
    border = "2px solid #ffffff";
    pulse = "box-shadow: 0 0 10px #f1c40f;";
  } else if (isSignificant) {
    color = "#e74c3c";
    size = 12;
    border = "2px solid #ffffff";
    pulse = "box-shadow: 0 0 8px rgba(231,76,60,0.8);";
  } else if (isExposed) {
    color = "#e67e22";
    size = 10;
    border = "1.5px solid #ffffff";
    pulse = "box-shadow: 0 0 6px rgba(230,126,34,0.7);";
  }

  return new L.DivIcon({
    className: "settlement-map-marker",
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:${border};${pulse}cursor:pointer;"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
};

const realtimeSarStyle = {
  color: "#ff9f1c",
  weight: 1.5,
  fillColor: "#ff9f1c",
  fillOpacity: 0.35,
};

const diffStyleFunction = (feature) => {
  const cls = feature.properties?.class || "agreement";
  if (cls === "agreement") {
    return { color: "#2ecc71", weight: 1.5, fillColor: "#2ecc71", fillOpacity: 0.45 };
  } else if (cls === "simulated_only") {
    return { color: "#3498db", weight: 1.5, fillColor: "#3498db", fillOpacity: 0.4 };
  } else {
    return { color: "#e67e22", weight: 1.5, fillColor: "#e67e22", fillOpacity: 0.4 };
  }
};

function MapController({ selectedSettlement }) {
  const map = useMap();
  useEffect(() => {
    if (selectedSettlement && selectedSettlement.lat && selectedSettlement.lon) {
      map.flyTo([selectedSettlement.lat, selectedSettlement.lon], 12, { duration: 1.2 });
    }
  }, [selectedSettlement, map]);
  return null;
}

export default function FloodMap({
  bounds,
  overlayUrl,
  overlayKey,
  breachLatLon,
  predictedLocation,
  realtimeExtent,
  sarDifferenceExtent = null,
  settlements = [],
  selectedSettlement = null,
  onSelectSettlement = null,
  showSettlements = true,
  allowLayerToggles = true,
}) {
  // Layer Toggles State
  const [showSim, setShowSim] = useState(true);
  const [showSarObs, setShowSarObs] = useState(true);
  const [showDiff, setShowDiff] = useState(false);
  const [baseLayer, setBaseLayer] = useState("dark"); // "dark" | "satellite"

  if (!bounds) return null;
  const leafletBounds = [
    [bounds.south, bounds.west],
    [bounds.north, bounds.east],
  ];
  const center = [(bounds.south + bounds.north) / 2, (bounds.west + bounds.east) / 2];

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* Floating Layer Controls */}
      {allowLayerToggles && (
        <div className="map-layer-toggles">
          <button
            className={`layer-pill ${showSim ? "active" : ""}`}
            onClick={() => setShowSim((v) => !v)}
            title="Toggle Simulated Flood Depth"
          >
            🌊 Simulation
          </button>
          <button
            className={`layer-pill ${showSarObs ? "active" : ""}`}
            onClick={() => setShowSarObs((v) => !v)}
            title="Toggle Sentinel-1 SAR Observation"
          >
            🛰️ SAR Obs
          </button>
          {sarDifferenceExtent && (
            <button
              className={`layer-pill pill-diff ${showDiff ? "active" : ""}`}
              onClick={() => setShowDiff((v) => !v)}
              title="Toggle Model vs Observation Difference Map"
            >
              ⚖️ Difference
            </button>
          )}
          <button
            className={`layer-pill ${baseLayer === "satellite" ? "active" : ""}`}
            onClick={() => setBaseLayer((l) => (l === "dark" ? "satellite" : "dark"))}
            title="Toggle Optical Satellite Base Layer"
          >
            🗺️ {baseLayer === "satellite" ? "Optical Base" : "Dark Map"}
          </button>
        </div>
      )}

      <MapContainer center={center} zoom={10} zoomControl={false} style={{ height: "100%", width: "100%" }}>
        <ZoomControl position="bottomleft" />
        
        {/* Base Map Tiles */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />

        {/* Optional Sentinel-2 Optical Base Layer Overlay */}
        {baseLayer === "satellite" && (
          <ImageOverlay
            url={satelliteUrl()}
            bounds={leafletBounds}
            opacity={0.85}
          />
        )}

        <MapController selectedSettlement={selectedSettlement} />

        {/* 1. Simulation Water Overlay */}
        {showSim && overlayUrl && (
          <ImageOverlay
            key={overlayKey || overlayUrl}
            url={overlayUrl}
            bounds={leafletBounds}
            opacity={0.85}
          />
        )}

        {/* 2. SAR Water Extent Polygons (Amber) */}
        {showSarObs && realtimeExtent && (
          <GeoJSON
            key={realtimeExtent.source?.scene_id || "realtime-sar"}
            data={realtimeExtent}
            style={realtimeSarStyle}
          />
        )}

        {/* 3. Model vs SAR Difference Polygons */}
        {showDiff && sarDifferenceExtent && (
          <GeoJSON
            key={JSON.stringify(sarDifferenceExtent.features?.length || 0)}
            data={sarDifferenceExtent}
            style={diffStyleFunction}
          />
        )}

        {/* Breach Marker */}
        {breachLatLon && (
          <Marker position={[breachLatLon.lat, breachLatLon.lon]} icon={breachIcon}>
            <Popup>
              <div style={{ fontSize: "12px", color: "#111" }}>
                <strong>Breach Inflow Location</strong>
                <br />
                {breachLatLon.lat.toFixed(4)}°N, {breachLatLon.lon.toFixed(4)}°E
              </div>
            </Popup>
          </Marker>
        )}

        {predictedLocation && (
          <Marker position={[predictedLocation.lat, predictedLocation.lon]} icon={barrageIcon}>
            <Popup>Prediction breach location</Popup>
          </Marker>
        )}

        {/* Settlements Overlay */}
        {showSettlements &&
          settlements.map((s) => {
            const isSelected = selectedSettlement?.osm_id === s.osm_id;
            const isExposed = s.current_depth_m >= 0.1 || s.is_exposed_current;
            const isSignificant = s.current_depth_m >= 0.3;
            const icon = createSettlementIcon(isExposed, isSignificant, isSelected);

            return (
              <Marker
                key={s.osm_id || `${s.lat}_${s.lon}`}
                position={[s.lat, s.lon]}
                icon={icon}
                eventHandlers={{
                  click: () => {
                    if (onSelectSettlement) {
                      onSelectSettlement(s);
                    }
                  },
                }}
              >
                <Popup>
                  <div style={{ fontSize: "12px", color: "#111", minWidth: "160px" }}>
                    <strong style={{ fontSize: "13px" }}>{s.name}</strong>
                    <span style={{ fontSize: "10px", color: "#666", display: "block", textTransform: "capitalize" }}>
                      {s.place_type} · {s.lat.toFixed(3)}°N, {s.lon.toFixed(3)}°E
                    </span>
                    <hr style={{ margin: "5px 0", border: "none", borderTop: "1px solid #eee" }} />
                    <div>
                      Water Arrival Time:{" "}
                      <strong>{s.arrival_time_minutes !== null ? `T+${s.arrival_time_minutes} min` : "Not reached"}</strong>
                    </div>
                    <div>
                      Simulated Depth:{" "}
                      <strong>{s.current_depth_m !== undefined ? `${s.current_depth_m.toFixed(2)} m` : "0.00 m"}</strong>
                    </div>
                    <div>
                      Max Scenario Depth:{" "}
                      <strong>{s.max_simulated_depth_m !== undefined ? `${s.max_simulated_depth_m.toFixed(2)} m` : "—"}</strong>
                    </div>
                    {s.local_worldpop_cell_population > 0 && (
                      <div>
                        Local Pop. Exposed:{" "}
                        <strong>{s.local_worldpop_cell_population.toLocaleString()}</strong>
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            );
          })}
      </MapContainer>
    </div>
  );
}
