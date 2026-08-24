import { MapContainer, TileLayer, ImageOverlay, Marker, Popup } from "react-leaflet";
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

export default function FloodMap({ bounds, overlayUrl, overlayKey, breachLatLon, predictedLocation }) {
  if (!bounds) return null;
  const leafletBounds = [
    [bounds.south, bounds.west],
    [bounds.north, bounds.east],
  ];
  const center = [(bounds.south + bounds.north) / 2, (bounds.west + bounds.east) / 2];

  return (
    <MapContainer center={center} zoom={10} style={{ height: "100%", width: "100%" }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {overlayUrl && (
        <ImageOverlay key={overlayKey || overlayUrl} url={overlayUrl} bounds={leafletBounds} opacity={0.85} />
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
