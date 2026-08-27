import re

def manual_resolve(filepath, choices):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    parts = []
    last_end = 0
    pattern = re.compile(r'<<<<<<< HEAD\r?\n(.*?)\r?\n?=======\r?\n(.*?)\r?\n?>>>>>>> [a-f0-9]+(?:\r?\n|$)', re.DOTALL)
    
    matches = list(pattern.finditer(content))
    if len(matches) != len(choices):
        print(f"Error: {filepath} has {len(matches)} conflicts, but {len(choices)} choices provided.")
        return
        
    for i, match in enumerate(matches):
        parts.append(content[last_end:match.start()])
        
        head = match.group(1)
        incoming = match.group(2)
        choice = choices[i]
        
        if choice == 'head':
            parts.append(head)
        elif choice == 'incoming':
            parts.append(incoming)
        elif callable(choice):
            parts.append(choice(head, incoming))
        else:
            parts.append(choice)
            
        last_end = match.end()
        
    parts.append(content[last_end:])
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write("".join(parts))

def app_c1(h, i):
    # Imports
    return """import { fetchResult, frameUrl, triggerRun, queryPointDepth, fetchImpactAnalysis, DEFAULT_JOB_ID } from "./api";
import ScenarioBuilder from "./components/ScenarioBuilder";
import ImpactDashboard from "./components/ImpactDashboard";"""

def app_c2(h, i):
    # State & load()
    return """  // Point Inspection State
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

  const load = (jobId = activeJobId) => {
    fetchResult(jobId)
      .then((data) => {
        setMeta(data);
        setFrameIndex(0);
        setError(null);
        // Load impact data
        fetchImpactAnalysis(jobId)
          .then(setImpactData)
          .catch((err) => console.warn("Impact analysis note:", err.message));
      })
      .catch((e) => setError(e.message));"""

def app_c3(h, i):
    # handleRerun
    return """      load(activeJobId);
      if (selectedPoint) {
        handlePointClick(selectedPoint);
      }"""

def app_c4(h, i):
    # handlePointClick & handleScenarioSelect
    return h + "\n" + i

def app_c5(h, i):
    # overlayUrl
    return """    (mode === "full" || mode === "realtime") && frame
      ? frameUrl(frame.overlay_png, activeJobId)"""

def app_c6(h, i):
    # FloodMap props
    return """                    overlayKey={mode === "full" || mode === "realtime" ? (frame?.overlay_png + activeJobId) : (prediction?.inference_s + String(predictedLocation))}
                    breachLatLon={meta.breach_latlon}
                    predictedLocation={mode === "instant" ? predictedLocation : null}
                    realtimeExtent={mode === "realtime" ? realtimeData : null}
                    sarDifferenceExtent={mode === "realtime" ? sarDifferenceData : null}
                    sarComparison={mode === "realtime" ? sarComparison : null}
                    sarLayers={mode === "realtime" ? sarLayers : { showSim: true, showSar: false, showDiff: false, baseSatellite: false }}
                    onPointClick={mode === "full" ? handlePointClick : undefined}
                    selectedPoint={selectedPoint}
                    selectedPointData={selectedPointData}
                    loadingPoint={loadingPoint}
                    frameIndex={frameIndex}
                    settlements={settlementsForMap}
                    selectedSettlement={selectedSettlement}
                    onSelectSettlement={setSelectedSettlement}
                    showSettlements={mode === "full"}
                    allowLayerToggles={true}"""

def app_c7(h, i):
    # CesiumViewer props
    return """                    jobId={activeJobId}
                  />
                )}
                {(mode === "full" || mode === "instant") && <Legend />}
                {mode === "full" && meta.frames && ("""

def app_c8(h, i):
    # InfoPanel props
    return """                  jobId={activeJobId}
                  onRerun={handleRerun}
                  running={running}
                  onOpenBuilder={() => setMode("builder")}
                  selectedPointData={selectedPointData}
                  loadingPoint={loadingPoint}
                  frameIndex={frameIndex}
                  onSelectTimestep={setFrameIndex}
                  onClearPoint={handleClearPoint}"""

def app_c9(h, i):
    # RealtimeSar props
    return """                  jobId={activeJobId}
                  meta={meta}
                  frameIndex={frameIndex}
                  frames={meta.frames}
                  onData={setRealtimeData}
                  onDifferenceData={setSarDifferenceData}
                  onComparisonChange={setSarComparison}
                  sarLayers={sarLayers}
                  setSarLayers={setSarLayers}"""

manual_resolve('frontend/src/App.jsx', [app_c1, app_c2, app_c3, app_c4, app_c5, app_c6, app_c7, app_c8, app_c9])

# FloodMap.jsx
def fm_c1(h, i):
    return """import { MapContainer, TileLayer, ImageOverlay, GeoJSON, Marker, Popup, ZoomControl, useMapEvents, useMap } from "react-leaflet";"""

def fm_c2(h, i):
    # breachIcon
    return """  html: '<div style="width:14px;height:14px;border-radius:50%;background:#ff3b30;border:2px solid white;box-shadow:0 0 6px rgba(0,0,0,0.8);"></div>',"""

def fm_c3(h, i):
    # icons
    return h + "\n" + i

def fm_c4(h, i):
    # diff styles and hooks
    return h + "\n" + i

def fm_c5(h, i):
    # FloodMap args
    return """  sarDifferenceExtent = null,
  settlements = [],
  selectedSettlement = null,
  onSelectSettlement = null,
  showSettlements = true,
  allowLayerToggles = true,
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
  
  // Layer Toggles State
  const [showSim, setShowSim] = useState(true);
  const [showSarObs, setShowSarObs] = useState(true);
  const [showDiff, setShowDiff] = useState(false);
  const [baseLayer, setBaseLayer] = useState("dark"); // "dark" | "satellite"
"""

def fm_c6(h, i):
    # map rendering top
    return """    <div style={{ position: "relative", width: "100%", height: "100%", cursor: "crosshair" }}>
      {/* Floating Layer Controls */}
      {allowLayerToggles && (
        <div className="map-layer-toggles" style={{ zIndex: 1000, position: 'absolute', top: 10, right: 10 }}>
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
"""

def fm_c7(h, i):
    # map rendering bottom
    return """        {/* Optional Sentinel-2 Optical Base Layer Overlay */}
        {baseLayer === "satellite" && (
          <ImageOverlay
            url={satelliteUrl()}
            bounds={leafletBounds}
            opacity={0.85}
          />
        )}
        
        <MapClickHandler onMapClick={onPointClick} />
        <MapController selectedSettlement={selectedSettlement} />

        {/* 1. Simulation Water Overlay */}
        {showSim && overlayUrl && sarLayers.showSim && (
          <ImageOverlay
            key={overlayKey || overlayUrl}
            url={overlayUrl}
            bounds={leafletBounds}
            opacity={0.85}
          />
        )}

        {/* 2. SAR Water Extent Polygons (Amber) */}
        {showSarObs && realtimeExtent && sarLayers.showSar && (
          <GeoJSON
            key={realtimeExtent.source?.scene_id || "realtime-sar"}
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

        {/* 3. Model vs SAR Difference Polygons */}
        {showDiff && sarDifferenceExtent && (
          <GeoJSON
            key={JSON.stringify(sarDifferenceExtent.features?.length || 0)}
            data={sarDifferenceExtent}
            style={diffStyleFunction}
          />
        )}
        
        {/* Point Inspection */}
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
    </div>"""

manual_resolve('frontend/src/components/FloodMap.jsx', [fm_c1, fm_c2, fm_c3, fm_c4, fm_c5, fm_c6, fm_c7])

# RealtimeSar.jsx
def rs_c1(h, i):
    return """import {
  fetchRealtimeWaterExtent,
  fetchSarComparison,
  fetchGeeAuthStatus,
  DEFAULT_JOB_ID,
  compareSarWithSimulation
} from "../api";
import { IconSatellite, IconCheck, IconArrowRight } from "./icons";"""

def rs_c2(h, i):
    return """  onData,
  onComparisonChange,
  sarLayers,
  setSarLayers,
  frameIndex = 0,
  frames = [],
  jobId = DEFAULT_JOB_ID,
  meta,
  onDifferenceData,
}) {
  const [data, setData] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [error, setError] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [authStatus, setAuthStatus] = useState(null);

  const activeTimestep = frames[frameIndex]?.t_minutes ?? null;"""

def rs_c3(h, i):
    return """    setAuthError(null);
    const params = {
      threshold_db: thresholdDb,
    };
    if (searchMode === "custom_dates") {
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
    }
    if (orbitPass !== "all") {
      params.orbit_pass = orbitPass;
    }

    fetchRealtimeWaterExtent(params)"""

def rs_c4(h, i):
    return """  const runComparison = (sarData, timestep) => {
    setComparing(true);
    setError(null);

    const options = {
      frame_index: frameIndex,
      threshold_db: thresholdDb,
    };
    if (searchMode === "custom_dates") {
      if (startDate) options.start_date = startDate;
      if (endDate) options.end_date = endDate;
    }
    if (orbitPass !== "all") {
      options.orbit_pass = orbitPass;
    }

    fetchSarComparison(jobId, options)
      .then((res) => {
        setComparison(res);
        onComparisonChange?.(res);
        if (res.difference_geojson && onDifferenceData) {
          onDifferenceData(res.difference_geojson);
        }
      })
      .catch((e) => {
        setError(e.message);
      })
      .finally(() => setComparing(false));
  };

  useEffect(() => {
    loadData();
  }, []);"""

def rs_c5(h, i):
    return h + "\n" + i

def rs_c6(h, i):
    return i

manual_resolve('frontend/src/components/RealtimeSar.jsx', [rs_c1, rs_c2, rs_c3, rs_c4, rs_c5, rs_c6])
