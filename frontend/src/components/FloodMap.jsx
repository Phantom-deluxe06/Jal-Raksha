import { useEffect, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  ImageOverlay,
  GeoJSON,
  Marker,
  Popup,
  ZoomControl,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

const breachIcon = new L.DivIcon({
  className: "breach-marker",
  html: '<div style="width:14px;height:14px;border-radius:50%;background:#ff3b30;border:2px solid white;box-shadow:0 0 6px rgba(255,59,48,0.8);"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const barrageIcon = new L.DivIcon({
  className: "barrage-marker",
  html: '<div style="width:12px;height:12px;background:#333;border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,0.6);"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

const inspectionIcon = new L.DivIcon({
  className: "inspection-marker",
  html: `
    <div style="position:relative;width:20px;height:20px;display:flex;align-items:center;justify-content:center;">
      <div style="position:absolute;width:18px;height:18px;border-radius:50%;background:rgba(74,144,255,0.4);animation:ping 1.5s cubic-bezier(0,0,0.2,1) infinite;"></div>
      <div style="width:12px;height:12px;border-radius:50%;background:#4a90ff;border:2px solid #ffffff;box-shadow:0 0 8px #4a90ff;z-index:2;"></div>
    </div>
  `,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

const realtimeSarStyle = {
  color: "#ff9f1c",
  weight: 1.5,
  fillColor: "#ff9f1c",
  fillOpacity: 0.4,
};

const getDifferenceStyle = (feature) => {
  const cat = feature.properties?.category;
  if (cat === "agreement") {
    return { color: "#3ddc97", weight: 2, fillColor: "#3ddc97", fillOpacity: 0.65 };
  }
  if (cat === "simulated_only") {
    return { color: "#4a90ff", weight: 1.5, fillColor: "#4a90ff", fillOpacity: 0.45 };
  }
  if (cat === "observed_only") {
    return { color: "#ff9f1c", weight: 1.5, fillColor: "#ff9f1c", fillOpacity: 0.45 };
  }
  return { color: "#ffffff", weight: 1, fillColor: "#888888", fillOpacity: 0.3 };
};

function MapClickHandler({ onMapClick }) {
  useMapEvents({
    click(e) {
      if (onMapClick) {
        onMapClick({ lat: e.latlng.lat, lon: e.latlng.lng });
      }
    },
  });
  return null;
}

export default function FloodMap({
  bounds,
  overlayUrl,
  overlayKey,
  breachLatLon,
  predictedLocation,
  realtimeExtent,
  sarComparison,
  sarLayers = { showSim: true, showSar: true, showDiff: false, baseSatellite: false },
  onPointClick,
  selectedPoint,
  selectedPointData,
  loadingPoint,
  frameIndex = 0,
}) {
  const markerRef = useRef(null);

  useEffect(() => {
    if (selectedPoint && markerRef.current) {
      markerRef.current.openPopup();
    }
  }, [selectedPoint]);

  if (!bounds) return null;
  const leafletBounds = [
    [bounds.south, bounds.west],
    [bounds.north, bounds.east],
  ];
  const center = [(bounds.south + bounds.north) / 2, (bounds.west + bounds.east) / 2];

  const currentSnapshot =
    selectedPointData?.timeseries && selectedPointData.timeseries[frameIndex]
      ? selectedPointData.timeseries[frameIndex]
      : null;

  return (
    <MapContainer
      center={center}
      zoom={10}
      zoomControl={false}
      style={{ height: "100%", width: "100%", cursor: "crosshair" }}
    >
      <ZoomControl position="bottomleft" />
      
      {/* Base Layer: Toggleable between Satellite and Dark Carto */}
      {sarLayers.baseSatellite ? (
        <TileLayer
          attribution='&copy; <a href="https://www.esri.com/">Esri</a>, Earthstar Geographics'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />
      ) : (
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
      )}
      
      <MapClickHandler onMapClick={onPointClick} />

      {/* 1. Simulation Water Extent Overlay */}
      {overlayUrl && sarLayers.showSim && (
        <ImageOverlay key={overlayKey || overlayUrl} url={overlayUrl} bounds={leafletBounds} opacity={0.85} />
      )}

      {/* 2. Real-time Sentinel-1 SAR Observed Water Extent */}
      {realtimeExtent && sarLayers.showSar && (
        <GeoJSON
          key={`sar-${realtimeExtent.source?.scene_id || "extent"}`}
          data={realtimeExtent}
          style={realtimeSarStyle}
          onEachFeature={(feature, layer) => {
            layer.bindPopup(`
              <div style="font-size:12px;line-height:1.4;">
                <strong style="color:#ff9f1c;">Sentinel-1 SAR Observed Water</strong><br/>
                Scene: <code>${realtimeExtent.source?.scene_id || "Live"}</code><br/>
                Acquired: ${realtimeExtent.source?.acquired_utc || "Recent pass"}
              </div>
            `);
          }}
        />
      )}

      {/* 3. Model vs Observation Difference / Agreement Layer */}
      {sarComparison?.difference_geojson && sarLayers.showDiff && (
        <GeoJSON
          key={`diff-${sarComparison.timestep_label || "comparison"}`}
          data={sarComparison.difference_geojson}
          style={getDifferenceStyle}
          onEachFeature={(feature, layer) => {
            const p = feature.properties || {};
            layer.bindPopup(`
              <div style="font-size:12px;line-height:1.4;">
                <strong style="color:${p.fill || '#fff'};">${p.label || "Comparison Region"}</strong><br/>
                <span>${p.description || ""}</span><br/>
                <strong>Area:</strong> ${p.area_km2 ? `${p.area_km2} km²` : "—"}
              </div>
            `);
          }}
        />
      )}

      {breachLatLon && (
        <Marker position={[breachLatLon.lat, breachLatLon.lon]} icon={breachIcon}>
          <Popup>
            <div style={{ fontSize: "12px", lineHeight: "1.4" }}>
              <strong>Kusaha Breach Site</strong><br />
              (2008-08-18, documented location)<br />
              <small className="mono">Lat: {breachLatLon.lat}°, Lon: {breachLatLon.lon}°</small>
            </div>
          </Popup>
        </Marker>
      )}

      {predictedLocation && (
        <Marker position={[predictedLocation.lat, predictedLocation.lon]} icon={barrageIcon}>
          <Popup>Prediction breach location</Popup>
        </Marker>
      )}

      {selectedPoint && (
        <Marker
          ref={markerRef}
          position={[selectedPoint.lat, selectedPoint.lon]}
          icon={inspectionIcon}
        >
          <Popup className="flood-query-popup" autoPan={false}>
            <div className="popup-query-card">
              <div className="popup-query-title">
                <span>📍 Point Query</span>
                <span className="popup-sim-time">
                  T+{currentSnapshot ? currentSnapshot.t_minutes : 0} min
                </span>
              </div>

              <div className="popup-coords mono">
                {selectedPoint.lat.toFixed(4)}° N, {selectedPoint.lon.toFixed(4)}° E
              </div>

              {loadingPoint ? (
                <div className="popup-loading">Querying simulation grid…</div>
              ) : selectedPointData ? (
                selectedPointData.in_bounds ? (
                  <div className="popup-metrics">
                    <div className="popup-metric-row">
                      <span>Water Depth:</span>
                      <strong style={{ color: currentSnapshot?.depth_m >= 0.1 ? "#4a90ff" : "#888" }}>
                        {currentSnapshot?.depth_m !== undefined ? `${currentSnapshot.depth_m.toFixed(2)} m` : "0.00 m"}
                        {currentSnapshot?.depth_m < 0.1 && " (Dry)"}
                      </strong>
                    </div>

                    <div className="popup-metric-row">
                      <span>Velocity:</span>
                      <strong>
                        {currentSnapshot?.velocity_mps !== undefined ? `${currentSnapshot.velocity_mps.toFixed(2)} m/s` : "0.00 m/s"}
                      </strong>
                    </div>

                    <div className="popup-metric-row">
                      <span>Arrival Time:</span>
                      <strong style={{ color: selectedPointData.arrival_time_min !== null ? "#ff9f1c" : "#3ddc97" }}>
                        {selectedPointData.arrival_time_min !== null
                          ? `T+${selectedPointData.arrival_time_min} min`
                          : "Not reached"}
                      </strong>
                    </div>

                    <div className="popup-metric-row subtle">
                      <span>Elevation / Grid:</span>
                      <span className="mono">
                        {selectedPointData.elevation_m}m • [{selectedPointData.grid_row}, {selectedPointData.grid_col}]
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="popup-oob">Outside simulation domain bounds</div>
                )
              ) : null}
            </div>
          </Popup>
        </Marker>
      )}
    </MapContainer>
  );
}
