import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import * as GeoTIFF from "geotiff";
import { frameUrl } from "../api";
import { VelocityParticleSystem } from "../utils/particleAdvection";
import { InfrastructureLayer } from "../utils/infrastructureLayer";
import { CinematicTourController, TOUR_SHOTS } from "../utils/cinematicController";
import { HadrInteractionController } from "../utils/hadrInteraction";
import InspectionPanel from "./InspectionPanel";

// Vertical exaggeration: 1.3x keeps the Gangetic floodplain readable
// without making the Himalayan foothills look cartoonish.
const VERTICAL_EXAGGERATION = 1.3;

// Flood surface colours — slightly more opaque so extent is clear
const FLOOD_STROKE = Cesium.Color.fromCssColorString("#4a90ff");
const FLOOD_FILL = Cesium.Color.fromCssColorString("#1e90ff").withAlpha(0.65);

export default function CesiumViewer({ bounds, frames = [], frameIndex = 0, setFrameIndex, jobId = "kosi_actual2008" }) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const [terrainError, setTerrainError] = useState(null);

  const [showSatellite, setShowSatellite] = useState(true);
  const satelliteLayerRef = useRef(null);

  const [showFlood, setShowFlood] = useState(true);
  const [meshesLoaded, setMeshesLoaded] = useState(false);
  const primitivesRef = useRef([]);

  const [showVelocity, setShowVelocity] = useState(true);
  const framesDataRef = useRef([]);
  const demDataRef = useRef(null);
  
  const [particleDensity, setParticleDensity] = useState(3000);
  const [particleSpeed, setParticleSpeed] = useState(1.0);
  const particleSystemRef = useRef(null);

  const [infraSettings, setInfraSettings] = useState({ showSettlements: true, showRoads: true, highlightInundated: false });
  const [infraStats, setInfraStats] = useState({ totalSettlements: 0, submergedSettlements: 0, atRiskSettlements: 0, populationAtRisk: 0 });
  const infraLayerRef = useRef(null);

  const cinematicControllerRef = useRef(null);
  const [activeShot, setActiveShot] = useState(null);
  const [isPlayingTour, setIsPlayingTour] = useState(false);
  const [showLiveTwinBadge, setShowLiveTwinBadge] = useState(false);

  const interactionControllerRef = useRef(null);
  const [activePick, setActivePick] = useState(null);
  const [hydraulics, setHydraulics] = useState({ depth: 0, velocity: 0 });

  const frame = frames && frames.length > frameIndex ? frames[frameIndex] : null;

  // Mount: create Viewer once
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    const terrain = Cesium.Terrain.fromWorldTerrain({
      requestVertexNormals: true,
      requestWaterMask: false,
    });
    terrain.errorEvent.addEventListener((err) => {
      console.error("Cesium World Terrain failed to load:", err);
      setTerrainError(err?.message || String(err));
    });

    const viewer = new Cesium.Viewer(containerRef.current, {
      terrain,
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      timeline: false,
      animation: false,
      homeButton: true,
      sceneModePicker: true,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
    });

    viewer.scene.globe.enableLighting = true;
    viewer.scene.verticalExaggeration = VERTICAL_EXAGGERATION;
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#c9c7bd");
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-08-25T04:00:00Z");
    viewer.clock.shouldAnimate = false;

    viewerRef.current = viewer;
    return () => {
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  // Camera & Satellite Layer
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !bounds) return;

    const rectangle = Cesium.Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north);
    viewer.camera.flyTo({ destination: rectangle, duration: 2 });

    let isMounted = true;

    Cesium.SingleTileImageryProvider.fromUrl("http://127.0.0.1:8000/terrain/satellite", {
      rectangle: rectangle,
    })
      .then((provider) => {
        if (!isMounted) return;
        const layer = viewer.imageryLayers.addImageryProvider(provider);
        satelliteLayerRef.current = layer;
        setShowSatellite((s) => {
          layer.show = s;
          layer.alpha = s ? 1.0 : 0.0;
          return s;
        });
      })
      .catch((err) => {
        console.error("Failed to load satellite imagery:", err);
      });

    return () => {
      isMounted = false;
      if (satelliteLayerRef.current && viewer && !viewer.isDestroyed()) {
        try {
          viewer.imageryLayers.remove(satelliteLayerRef.current);
        } catch (e) {}
        satelliteLayerRef.current = null;
      }
    };
  }, [bounds]);

  useEffect(() => {
    if (!viewerRef.current || cinematicControllerRef.current) return;
    
    const onShotChange = (shot, isPlaying) => {
      setActiveShot(shot);
      setIsPlayingTour(isPlaying);
      if (!shot) return;
      
      if (shot.actions.frameIndex !== undefined && setFrameIndex) {
        setFrameIndex(shot.actions.frameIndex);
      }
      if (shot.actions.showVelocity !== undefined) {
        setShowVelocity(shot.actions.showVelocity);
      }
      if (shot.actions.showSettlements !== undefined || shot.actions.highlightInundated !== undefined) {
        setInfraSettings(s => ({
          ...s,
          showSettlements: shot.actions.showSettlements !== undefined ? shot.actions.showSettlements : s.showSettlements,
          highlightInundated: shot.actions.highlightInundated !== undefined ? shot.actions.highlightInundated : s.highlightInundated
        }));
      }
      setShowLiveTwinBadge(shot.actions.showLiveTwinBadge || false);
    };

    const onTourPause = () => {
      setIsPlayingTour(false);
    };

    cinematicControllerRef.current = new CinematicTourController(viewerRef.current, onShotChange, onTourPause);

    return () => {
      if (cinematicControllerRef.current) {
        cinematicControllerRef.current.destroy();
        cinematicControllerRef.current = null;
      }
    };
  }, [setFrameIndex]);

  // Init HADR Interaction Controller
  useEffect(() => {
    if (!viewerRef.current || interactionControllerRef.current) return;
    
    interactionControllerRef.current = new HadrInteractionController(viewerRef.current, (pickData) => {
      setActivePick(pickData);
    });

    return () => {
      if (interactionControllerRef.current) {
        interactionControllerRef.current.destroy();
        interactionControllerRef.current = null;
      }
    };
  }, []);

  // Update hydraulics when activePick or frameIndex changes
  useEffect(() => {
    if (!activePick || !bounds || !framesDataRef.current[frameIndex] || !demDataRef.current) {
      setHydraulics({ depth: 0, velocity: 0 });
      return;
    }

    const { lat, lon } = activePick;
    const { rows, cols } = demDataRef.current;
    
    const dLat = (bounds.north - bounds.south) / rows;
    const dLon = (bounds.east - bounds.west) / cols;

    const c = Math.floor((lon - bounds.west) / dLon);
    const r = Math.floor((bounds.north - lat) / dLat);

    if (r >= 0 && r < rows && c >= 0 && c < cols) {
      const idx = r * cols + c;
      const fData = framesDataRef.current[frameIndex];
      const depth = fData.depthData[idx] || 0;
      const u = fData.uData[idx] || 0;
      const v = fData.vData[idx] || 0;
      const velocity = Math.sqrt(u * u + v * v);

      setHydraulics({ depth, velocity });
    } else {
      setHydraulics({ depth: 0, velocity: 0 });
    }
  }, [activePick, frameIndex, bounds]);

  useEffect(() => {
    if (satelliteLayerRef.current) {
      satelliteLayerRef.current.show = showSatellite;
      satelliteLayerRef.current.alpha = showSatellite ? 1.0 : 0.0;
    }
  }, [showSatellite]);

  // Pre-generate all meshes on load for smooth playback
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !bounds || !frames || frames.length === 0) return;

    let isMounted = true;

    async function loadAllMeshes() {
      try {
        const demRes = await fetch("http://127.0.0.1:8000/terrain/dem?downsample=1");
        const demData = await demRes.json();

        const { rows, cols } = demData;
        const dLat = (bounds.north - bounds.south) / rows;
        const dLon = (bounds.east - bounds.west) / cols;

        const primitives = [];
        const materialAppearance = new Cesium.MaterialAppearance({
          material: Cesium.Material.fromType("Color", {
            color: new Cesium.Color(0.12, 0.53, 0.9, 0.6),
          }),
          translucent: true,
        });

        const meshPromises = frames.map(async (f) => {
          const fetchTif = async (tifPath) => {
            if (!tifPath) return null;
            const tifName = tifPath.split("/").pop();
            const res = await fetch(`http://127.0.0.1:8000/simulate/frame/${jobId}/${tifName}`);
            if (!res.ok) return null;
            const buffer = await res.arrayBuffer();
            const tiff = await GeoTIFF.fromArrayBuffer(buffer);
            const image = await tiff.getImage();
            return (await image.readRasters())[0];
          };

          const [depthData, uData, vData] = await Promise.all([
            fetchTif(f.depth_tif),
            fetchTif(f.u_tif),
            fetchTif(f.v_tif),
          ]);

          if (!depthData) return null;

          let numFlooded = 0;
          for (let j = 0; j < depthData.length; j++) {
            if (depthData[j] > 0.1) numFlooded++;
          }

          if (numFlooded === 0) return null;

          const positions = new Float64Array(numFlooded * 4 * 3);
          const indices = new Uint32Array(numFlooded * 6);

          let vertexOffset = 0;
          let indexOffset = 0;

          for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
              const idx = r * cols + c;
              const depth = depthData[idx];

              if (depth > 0.1) {
                const elev = demData.elevations[idx] + depth;

                const latN = bounds.north - r * dLat;
                const latS = bounds.north - (r + 1) * dLat;
                const lonW = bounds.west + c * dLon;
                const lonE = bounds.west + (c + 1) * dLon;

                const p0 = Cesium.Cartesian3.fromDegrees(lonW, latN, elev);
                const p1 = Cesium.Cartesian3.fromDegrees(lonE, latN, elev);
                const p2 = Cesium.Cartesian3.fromDegrees(lonE, latS, elev);
                const p3 = Cesium.Cartesian3.fromDegrees(lonW, latS, elev);

                positions[vertexOffset * 3] = p0.x;
                positions[vertexOffset * 3 + 1] = p0.y;
                positions[vertexOffset * 3 + 2] = p0.z;

                positions[(vertexOffset + 1) * 3] = p1.x;
                positions[(vertexOffset + 1) * 3 + 1] = p1.y;
                positions[(vertexOffset + 1) * 3 + 2] = p1.z;

                positions[(vertexOffset + 2) * 3] = p2.x;
                positions[(vertexOffset + 2) * 3 + 1] = p2.y;
                positions[(vertexOffset + 2) * 3 + 2] = p2.z;

                positions[(vertexOffset + 3) * 3] = p3.x;
                positions[(vertexOffset + 3) * 3 + 1] = p3.y;
                positions[(vertexOffset + 3) * 3 + 2] = p3.z;

                indices[indexOffset] = vertexOffset;
                indices[indexOffset + 1] = vertexOffset + 3;
                indices[indexOffset + 2] = vertexOffset + 1;
                indices[indexOffset + 3] = vertexOffset + 1;
                indices[indexOffset + 4] = vertexOffset + 3;
                indices[indexOffset + 5] = vertexOffset + 2;

                vertexOffset += 4;
                indexOffset += 6;
              }
            }
          }

          const geometry = new Cesium.Geometry({
            attributes: {
              position: new Cesium.GeometryAttribute({
                componentDatatype: Cesium.ComponentDatatype.DOUBLE,
                componentsPerAttribute: 3,
                values: positions,
              }),
            },
            indices: indices,
            primitiveType: Cesium.PrimitiveType.TRIANGLES,
            boundingSphere: Cesium.BoundingSphere.fromVertices(positions),
          });

          Cesium.GeometryPipeline.computeNormal(geometry);
          const instance = new Cesium.GeometryInstance({ geometry });

          const primitive = new Cesium.Primitive({
            geometryInstances: instance,
            appearance: materialAppearance,
            asynchronous: false,
          });

          return { primitive, memoryBytes: numFlooded * 12 * 8 + numFlooded * 6 * 4, depthData, uData, vData };
        });

        const generatedData = await Promise.all(meshPromises);
        if (!isMounted) return;

        generatedData.forEach((data) => {
          if (data && data.primitive) {
            data.primitive.show = false;
            viewer.scene.primitives.add(data.primitive);
            primitives.push(data.primitive);
          } else {
            primitives.push(null);
          }
        });

        if (!isMounted) return;
        primitivesRef.current = primitives;
        framesDataRef.current = generatedData;
        demDataRef.current = demData;
        setMeshesLoaded(true);
      } catch (err) {
        console.error("Failed to load 3D flood surfaces:", err);
      }
    }

    loadAllMeshes();

    return () => {
      isMounted = false;
      if (viewer && !viewer.isDestroyed()) {
        primitivesRef.current.forEach((p) => {
          if (p) {
            try {
              viewer.scene.primitives.remove(p);
            } catch (e) {}
          }
        });
      }
      primitivesRef.current = [];
      setMeshesLoaded(false);
    };
  }, [bounds, frames, jobId]);

  // Sync visibility with timeline
  useEffect(() => {
    primitivesRef.current.forEach((primitive, i) => {
      if (primitive) {
        primitive.show = i === frameIndex && showFlood;
      }
    });
  }, [frameIndex, showFlood, meshesLoaded]);

  useEffect(() => {
    if (particleSystemRef.current) {
      particleSystemRef.current.setShow(showVelocity);
    }
  }, [showVelocity]);

  // Velocity Flow Particles via VelocityParticleSystem
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !meshesLoaded || !demDataRef.current || !bounds) return;

    if (!particleSystemRef.current) {
      particleSystemRef.current = new VelocityParticleSystem(viewer, bounds);
      const { rows, cols } = demDataRef.current;
      particleSystemRef.current.setGridData(demDataRef.current, rows, cols);
    }

    if (!infraLayerRef.current) {
      infraLayerRef.current = new InfrastructureLayer(viewer, bounds);
      infraLayerRef.current.loadData().then(() => {
        setInfraStats({ ...infraLayerRef.current.stats });
      });
    }

    const fData = framesDataRef.current[frameIndex];
    if (fData) {
      particleSystemRef.current.setFrameData(fData.depthData, fData.uData, fData.vData);
      
      // Update infrastructure submergence
      if (infraLayerRef.current.loaded) {
        infraLayerRef.current.updateTimestep(fData.depthData, demDataRef.current, demDataRef.current.rows, demDataRef.current.cols);
        setInfraStats({ ...infraLayerRef.current.stats });
      }
    }

    let lastTime = performance.now();
    const onPreUpdate = () => {
      const now = performance.now();
      const dt = (now - lastTime) / 1000.0;
      lastTime = now;
      if (particleSystemRef.current) {
        particleSystemRef.current.update(dt, particleSpeed, particleDensity);
      }
    };

    viewer.scene.preUpdate.addEventListener(onPreUpdate);

    return () => {
      viewer.scene.preUpdate.removeEventListener(onPreUpdate);
    };
  }, [frameIndex, meshesLoaded, bounds, particleSpeed, particleDensity]);

  // Sync infrastructure settings
  useEffect(() => {
    if (infraLayerRef.current) {
      infraLayerRef.current.setShowSettlements(infraSettings.showSettlements);
      infraLayerRef.current.setShowRoads(infraSettings.showRoads);
      infraLayerRef.current.setHighlightInundatedOnly(infraSettings.highlightInundated);
    }
  }, [infraSettings]);

  return (
    <div className="cesium-viewer-container" style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {/* Cinematic Mode UI */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1000,
          background: "rgba(10, 10, 10, 0.8)",
          padding: "8px 16px",
          borderRadius: "20px",
          color: "white",
          display: "flex",
          gap: "12px",
          alignItems: "center",
          backdropFilter: "blur(6px)",
          border: "1px solid rgba(255,255,255,0.15)",
          boxShadow: "0 4px 15px rgba(0,0,0,0.5)",
          pointerEvents: "auto"
        }}
      >
        {!isPlayingTour && !activeShot && (
          <button 
            onClick={() => cinematicControllerRef.current?.startTour()}
            style={{ background: "#4a90ff", color: "white", border: "none", padding: "6px 14px", borderRadius: "12px", cursor: "pointer", fontWeight: "bold", display: "flex", alignItems: "center", gap: "6px" }}
          >
            ▶ Start 7-Shot Cinematic Tour
          </button>
        )}
        
        {(isPlayingTour || activeShot) && (
          <>
            {isPlayingTour ? (
              <button onClick={() => cinematicControllerRef.current?.pauseTour()} style={{ background: "rgba(255,255,255,0.1)", color: "white", border: "none", padding: "6px 12px", borderRadius: "8px", cursor: "pointer" }}>
                ⏸ Pause
              </button>
            ) : (
              <button onClick={() => cinematicControllerRef.current?.resumeTour()} style={{ background: "#4a90ff", color: "white", border: "none", padding: "6px 12px", borderRadius: "8px", cursor: "pointer" }}>
                ▶ Resume
              </button>
            )}
            <button onClick={() => cinematicControllerRef.current?.stopTour()} style={{ background: "rgba(255,100,100,0.2)", color: "#ff6b6b", border: "none", padding: "6px 12px", borderRadius: "8px", cursor: "pointer" }}>
              ⏹ Exit
            </button>
            
            <div style={{ width: "1px", height: "20px", background: "rgba(255,255,255,0.2)" }} />
            
            <div style={{ display: "flex", gap: "4px" }}>
              {TOUR_SHOTS.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => cinematicControllerRef.current?.skipToShot(i)}
                  style={{
                    width: "24px", height: "24px", borderRadius: "12px", border: "none", cursor: "pointer",
                    background: activeShot?.id === s.id ? "#4a90ff" : "rgba(255,255,255,0.1)",
                    color: activeShot?.id === s.id ? "white" : "#aaa",
                    fontSize: "12px", fontWeight: "bold",
                    display: "flex", alignItems: "center", justifyContent: "center"
                  }}
                >
                  {s.id}
                </button>
              ))}
            </div>
            
            <div style={{ width: "1px", height: "20px", background: "rgba(255,255,255,0.2)" }} />
            
            <div style={{ fontSize: "13px", fontWeight: "500", minWidth: "120px" }}>
              {activeShot ? `Shot ${activeShot.id} / 7` : "Paused"}
            </div>
          </>
        )}
      </div>

      {/* Cinematic Narrative Overlay Card */}
      {activeShot && (
        <div
          style={{
            position: "absolute",
            bottom: 40,
            left: 20,
            zIndex: 1000,
            width: "360px",
            background: "linear-gradient(135deg, rgba(20,20,30,0.9) 0%, rgba(10,10,15,0.8) 100%)",
            padding: "20px",
            borderRadius: "12px",
            color: "white",
            border: "1px solid rgba(100, 150, 255, 0.3)",
            backdropFilter: "blur(10px)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.7)",
            pointerEvents: "none",
            animation: "fadeIn 0.5s ease-out"
          }}
        >
          <div style={{ fontSize: "11px", color: "#4a90ff", textTransform: "uppercase", letterSpacing: "1px", fontWeight: "bold", marginBottom: "4px" }}>
            Cinematic Tour • Shot {activeShot.id}
          </div>
          <div style={{ fontSize: "20px", fontWeight: "600", marginBottom: "12px", lineHeight: "1.2" }}>
            {activeShot.title}
          </div>
          <div style={{ fontSize: "14px", color: "#ddd", marginBottom: "16px", lineHeight: "1.5" }}>
            {activeShot.description}
          </div>
          <div style={{ height: "1px", background: "rgba(255,255,255,0.1)", marginBottom: "12px" }} />
          <div style={{ fontSize: "12px", display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#888" }}>Telemetry</span>
              <span style={{ color: "#55efc4", fontWeight: "500" }}>{activeShot.telemetry}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#888" }}>Physics Overlay</span>
              <span style={{ color: "#ff9f1c", fontWeight: "500" }}>{activeShot.physics}</span>
            </div>
          </div>
        </div>
      )}

      {/* Live Twin Badge for Shot 6 */}
      {showLiveTwinBadge && (
        <div style={{
          position: "absolute", top: 120, right: 20, zIndex: 1000, background: "rgba(10,40,10,0.85)", border: "1px solid #4cd137", borderRadius: "8px", padding: "10px 16px", color: "white", display: "flex", alignItems: "center", gap: "10px", backdropFilter: "blur(4px)"
        }}>
          <div style={{ width: "10px", height: "10px", background: "#4cd137", borderRadius: "50%", boxShadow: "0 0 8px #4cd137", animation: "pulse 1.5s infinite" }} />
          <div>
            <div style={{ fontSize: "11px", color: "#4cd137", fontWeight: "bold", textTransform: "uppercase" }}>Live Telemetry Sync</div>
            <div style={{ fontSize: "14px", fontWeight: "600" }}>CWC: 062-MGD4PTN</div>
          </div>
        </div>
      )}

      {terrainError && (
        <div
          className="cesium-terrain-error"
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            background: "rgba(255,0,0,0.8)",
            color: "white",
            padding: "10px",
            borderRadius: "4px",
            zIndex: 1000,
          }}
        >
          {terrainError}
        </div>
      )}

      {/* HADR Inspection Panel */}
      <InspectionPanel
        pickedData={activePick}
        hydraulics={hydraulics}
        onClose={() => setActivePick(null)}
      />

      {/* Layer Toggles */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          position: "absolute",
          top: 10,
          right: 10,
          zIndex: 1000,
          background: "rgba(30, 30, 30, 0.85)",
          padding: "10px 14px",
          borderRadius: "6px",
          color: "white",
          border: "1px solid rgba(255,255,255,0.2)",
          backdropFilter: "blur(4px)",
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "14px", margin: 0 }}>
          <input
            type="checkbox"
            checked={showSatellite}
            onChange={(e) => setShowSatellite(e.target.checked)}
            style={{ margin: 0, width: "16px", height: "16px", cursor: "pointer" }}
          />
          Satellite Imagery
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "14px", margin: 0 }}>
          <input
            type="checkbox"
            checked={showFlood}
            onChange={(e) => setShowFlood(e.target.checked)}
            style={{ margin: 0, width: "16px", height: "16px", cursor: "pointer" }}
          />
          3D Water Surface
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "14px", margin: 0 }}>
          <input
            type="checkbox"
            checked={showVelocity}
            onChange={(e) => setShowVelocity(e.target.checked)}
            style={{ margin: 0, width: "16px", height: "16px", cursor: "pointer" }}
          />
          Velocity Flow Particles
        </label>
        
        <div style={{ height: "1px", background: "rgba(255,255,255,0.2)", margin: "4px 0" }} />
        
        <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "14px", margin: 0 }}>
          <input
            type="checkbox"
            checked={infraSettings.showSettlements}
            onChange={(e) => setInfraSettings(s => ({ ...s, showSettlements: e.target.checked }))}
            style={{ margin: 0, width: "16px", height: "16px", cursor: "pointer" }}
          />
          Settlements & Facilities
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "14px", margin: 0 }}>
          <input
            type="checkbox"
            checked={infraSettings.showRoads}
            onChange={(e) => setInfraSettings(s => ({ ...s, showRoads: e.target.checked }))}
            style={{ margin: 0, width: "16px", height: "16px", cursor: "pointer" }}
          />
          <span>Road Network (depth-coded)</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "14px", margin: 0, marginTop: "4px" }}>
          <input
            type="checkbox"
            checked={infraSettings.highlightInundated}
            onChange={(e) => setInfraSettings(s => ({ ...s, highlightInundated: e.target.checked }))}
            style={{ margin: 0, width: "16px", height: "16px", cursor: "pointer" }}
          />
          Highlight Inundated Only
        </label>
      </div>

      {/* Flood Stats Overlay */}
      {frame && (
        <div className="cesium-flood-stats" style={{ zIndex: 1000 }}>
          <div className="cesium-flood-stats-title">T+{frame.t_minutes} min</div>
          <div className="cesium-flood-stats-grid">
            <div>
              <span>Flooded area</span>
              <strong>{frame.flooded_area_km2.toLocaleString()} km²</strong>
            </div>
            <div>
              <span>Max depth</span>
              <strong>{frame.max_depth_m} m</strong>
            </div>
            {frame.population_at_risk !== undefined && (
              <div>
                <span>Pop at risk</span>
                <strong>{frame.population_at_risk.toLocaleString()}</strong>
              </div>
            )}
            {frame.affected_settlements_count !== undefined && (
              <div>
                <span>Settlements</span>
                <strong>{frame.affected_settlements_count}</strong>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Infrastructure Impact HUD */}
      {infraSettings.showSettlements && infraStats.totalSettlements > 0 && (
        <div
          style={{
            position: "absolute",
            top: 240,
            left: 10,
            zIndex: 1000,
            background: "rgba(20,20,20,0.85)",
            padding: "12px 16px",
            borderRadius: "8px",
            color: "white",
            border: "1px solid rgba(255,100,100,0.4)",
            backdropFilter: "blur(4px)",
            fontSize: "13px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
            minWidth: "220px"
          }}
        >
          <div style={{ marginBottom: "8px", fontWeight: "600", color: "#ff9f1c", textTransform: "uppercase", fontSize: "11px", letterSpacing: "1px" }}>
            Live Infrastructure Impact
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
            <span>Submerged (<span style={{color: "#ff6b6b"}}>≥0.3m</span>)</span>
            <strong>{infraStats.submergedSettlements} / {infraStats.totalSettlements}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
            <span>At Risk (<span style={{color: "#ff9f1c"}}>≥0.1m</span>)</span>
            <strong>{infraStats.atRiskSettlements}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px", color: "#aaa" }}>
            <span>Submerged Roads</span>
            <strong>— km</strong>
          </div>
          <div style={{ height: "1px", background: "rgba(255,255,255,0.2)", margin: "8px 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", color: "#ff6b6b" }}>
            <span>Population at Risk</span>
            <strong>{infraStats.populationAtRisk.toLocaleString()}</strong>
          </div>
        </div>
      )}

      {/* Particle Controls & Legend */}
      {showVelocity && (
        <>
          {/* Legend */}
          <div
            style={{
              position: "absolute",
              bottom: 15,
              right: 15,
              zIndex: 1000,
              background: "rgba(20,20,20,0.85)",
              padding: "12px 16px",
              borderRadius: "8px",
              color: "white",
              border: "1px solid rgba(255,255,255,0.15)",
              backdropFilter: "blur(4px)",
              fontSize: "12px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
              minWidth: "280px"
            }}
          >
            <div style={{ marginBottom: "6px", fontWeight: "600", color: "#ddd" }}>SWE Field Velocity</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
              <span>Min 0.0 m/s</span>
              <span>Mean 1.8 m/s</span>
              <span>Max 3.9 m/s</span>
            </div>
            <div
              style={{
                height: "6px",
                width: "100%",
                background: "linear-gradient(90deg, cyan, yellow, orange, red)",
                borderRadius: "3px",
                marginBottom: "4px",
              }}
            />
            <div style={{ display: "flex", justifyContent: "space-between", color: "#aaa", fontSize: "11px" }}>
              <span>0.5</span>
              <span>2.0</span>
              <span>3.5+</span>
            </div>
            <div style={{ marginTop: "6px", color: "#ff6b6b", fontSize: "11px", fontStyle: "italic" }}>
              (Near-field SPH peak: 11.9 m/s)
            </div>
          </div>

          {/* Controls */}
          <div
            style={{
              position: "absolute",
              top: 130,
              right: 10,
              zIndex: 1000,
              background: "rgba(30, 30, 30, 0.85)",
              padding: "10px 14px",
              borderRadius: "6px",
              color: "white",
              border: "1px solid rgba(255,255,255,0.2)",
              backdropFilter: "blur(4px)",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              width: "200px"
            }}
          >
            <div>
              <label style={{ fontSize: "12px", display: "flex", justifyContent: "space-between" }}>
                <span>Particle Density</span>
                <span>{particleDensity}</span>
              </label>
              <input
                type="range"
                min="500"
                max="10000"
                step="500"
                value={particleDensity}
                onChange={(e) => setParticleDensity(Number(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "12px", display: "flex", justifyContent: "space-between" }}>
                <span>Speed Multiplier</span>
                <span>{particleSpeed}x</span>
              </label>
              <input
                type="range"
                min="0.1"
                max="5.0"
                step="0.1"
                value={particleSpeed}
                onChange={(e) => setParticleSpeed(Number(e.target.value))}
                style={{ width: "100%" }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
