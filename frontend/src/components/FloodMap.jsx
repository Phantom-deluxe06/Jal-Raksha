import { MapContainer, TileLayer, ImageOverlay, GeoJSON, Marker, Popup, ZoomControl } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

const breachIcon = new L.DivIcon({
  className: "breach-marker",
  html: '<div style="width:14px;height:14px;border-radius:50%;background:#ff3b30;border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,0.6);"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const barrageIcon = new L.DivIcon({
  className: "barrage-marker",
  html: '<div style="width:12px;height:12px;background:#333;border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,0.6);"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

const realtimeSarStyle = {
  color: "#ff9f1c",
  weight: 1,
  fillColor: "#ff9f1c",
  fillOpacity: 0.35,
};

export default function FloodMap({ bounds, overlayUrl, overlayKey, breachLatLon, predictedLocation, realtimeExtent }) {
  if (!bounds) return null;
  const leafletBounds = [
    [bounds.south, bounds.west],
    [bounds.north, bounds.east],
  ];
  const center = [(bounds.south + bounds.north) / 2, (bounds.west + bounds.east) / 2];

  return (
    <MapContainer center={center} zoom={10} zoomControl={false} style={{ height: "100%", width: "100%" }}>
      <ZoomControl position="bottomleft" />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />
      {overlayUrl && (
        <ImageOverlay key={overlayKey || overlayUrl} url={overlayUrl} bounds={leafletBounds} opacity={0.85} />
      )}
      {realtimeExtent && (
        <GeoJSON
          key={realtimeExtent.source?.scene_id || "realtime-sar"}
          data={realtimeExtent}
          style={realtimeSarStyle}
        />
      )}
      {breachLatLon && (
        <Marker position={[breachLatLon.lat, breachLatLon.lon]} icon={breachIcon}>
          <Popup>Kusaha breach site (2008-08-18, documented location)</Popup>
        </Marker>
      )}
      {predictedLocation && (
        <Marker position={[predictedLocation.lat, predictedLocation.lon]} icon={barrageIcon}>
          <Popup>Prediction breach location</Popup>
        </Marker>
      )}
    </MapContainer>
  );
}
