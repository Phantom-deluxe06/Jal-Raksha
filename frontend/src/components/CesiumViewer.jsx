import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import * as GeoTIFF from "geotiff";
import { VelocityParticleSystem } from "../utils/particleAdvection";
import { InfrastructureLayer } from "../utils/infrastructureLayer";
import { CinematicTourController, TOUR_SHOTS } from "../utils/cinematicController";
import { HadrInteractionController } from "../utils/hadrInteraction";
import InspectionPanel from "./InspectionPanel";

// Vertical exaggeration: 1.3x keeps the Gangetic floodplain readable
// without making the Himalayan foothills look cartoonish.
const VERTICAL_EXAGGERATION = 1.3;

// Default opening camera: oblique (not top-down) so terrain relief reads.
const DEFAULT_PITCH_DEG = -40;
// Smooth particle playback default; users raise it manually.
const DEFAULT_PARTICLE_DENSITY = 900;
const IDLE_ORBIT_DELAY_MS = 10000;

// Depth buckets for the 3D water surface — drives per-mesh transparency
// (shallow water reads as translucent, deep water opaque + darker).
const WATER_BUCKETS = [
  { min: 0.1, max: 0.5, color: [0.30, 0.62, 0.95, 0.32] },
  { min: 0.5, max: 2.0, color: [0.13, 0.45, 0.90, 0.55] },
  { min: 2.0, max: Infinity, color: [0.05, 0.20, 0.55, 0.82] },
];

export default function CesiumViewer({ bounds, frames = [], frameIndex = 0, setFrameIndex, jobId = "kosi_actual2008", onCinematicChange }) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const [terrainError, setTerrainError] = useState(null);

  const [showSatellite, setShowSatellite] = useState(true);
  const satelliteLayerRef = useRef(null);

  const [showFlood, setShowFlood] = useState(true);
  const [meshesLoaded, setMeshesLoaded] = useState(false);

  const [showVelocity, setShowVelocity] = useState(true);
  const framesDataRef = useRef([]);
  const demDataRef = useRef(null);
  
  const [particleDensity, setParticleDensity] = useState(DEFAULT_PARTICLE_DENSITY);
  const [particleSpeed, setParticleSpeed] = useState(1.0);
  const particleSystemRef = useRef(null);
  const [showParticleSettings, setShowParticleSettings] = useState(false);
  const particlePopupRef = useRef(null);
  const [showLayerPanel, setShowLayerPanel] = useState(true);

  // Idle auto-orbit + render-loop bookkeeping
  const lastInteractionRef = useRef(0);
  const autoOrbitingRef = useRef(false);
  const orbitCenterRef = useRef(null);
  const rafRef = useRef(null);
  const showVelocityRef = useRef(true);
  const lastFrameChangeRef = useRef(0);
  const cinematicRef = useRef(false);

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

    const scene = viewer.scene;
    const globe = scene.globe;

    globe.enableLighting = true;
    scene.verticalExaggeration = VERTICAL_EXAGGERATION;
    globe.baseColor = Cesium.Color.fromCssColorString("#c9c7bd");
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-08-25T04:00:00Z");
    viewer.clock.shouldAnimate = false;

    // --- 3D depth cues ---------------------------------------------------
    viewer.shadows = true;
    viewer.terrainShadows = Cesium.ShadowMode.ENABLED;
    scene.shadowMap.enabled = true;
    scene.shadowMap.size = 2048;
    scene.shadowMap.softShadows = true;
    globe.showGroundAtmosphere = true;
    globe.depthTestAgainstTerrain = true;
    scene.fog.enabled = true;
    scene.fog.density = 0.0002;
    scene.skyAtmosphere.show = true;

    // --- Performance ---------------------------------------------------
    scene.requestRenderMode = true;
    scene.maximumRenderTimeChange = 0.1;
    globe.tileCacheSize = 100;

    // Any real user interaction cancels idle auto-orbit and defers the timer.
    const bump = () => {
      lastInteractionRef.current = Date.now();
      autoOrbitingRef.current = false;
    };
    scene.canvas.addEventListener("pointerdown", bump);
    scene.canvas.addEventListener("wheel", bump, { passive: true });

    viewerRef.current = viewer;
    return () => {
      try {
        scene.canvas.removeEventListener("pointerdown", bump);
        scene.canvas.removeEventListener("wheel", bump);
      } catch (e) { /* canvas already gone */ }
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  // Camera & Satellite Layer
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !bounds) return;

    const rectangle = Cesium.Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north);
    // Oblique opening framing so terrain relief is visible (not top-down).
    const c = Cesium.Rectangle.center(rectangle);
    orbitCenterRef.current = Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, 0);
    const spanM = Cesium.Cartesian3.distance(
      Cesium.Cartesian3.fromRadians(rectangle.west, rectangle.south),
      Cesium.Cartesian3.fromRadians(rectangle.east, rectangle.north)
    );
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromRadians(
        c.longitude,
        c.latitude - Cesium.Math.toRadians(0.18),
        spanM * 0.9
      ),
      orientation: {
        heading: 0.0,
        pitch: Cesium.Math.toRadians(DEFAULT_PITCH_DEG),
        roll: 0.0,
      },
      duration: 2.5,
      easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
    });
    lastInteractionRef.current = Date.now();

    let isMounted = true;

    Cesium.SingleTileImageryProvider.fromUrl("http://127.0.0.1:8000/terrain/satellite", {
      rectangle: rectangle,
    })
      .then((provider) => {
        if (!isMounted) return;
        const layer = viewer.imageryLayers.addImageryProvider(provider);
        // Make the real satellite imagery pop.
        layer.brightness = 1.1;
        layer.contrast = 1.2;
        layer.saturation = 1.1;
        layer.gamma = 1.0;
        satelliteLayerRef.current = layer;
        setShowSatellite((s) => {
          layer.show = s;
          layer.alpha = s ? 1.0 : 0.0;
          return s;
        });
        viewer.scene.requestRender();
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

  // Keep refs in sync for the rAF render loop
  useEffect(() => { showVelocityRef.current = showVelocity; }, [showVelocity]);
  useEffect(() => {
    lastFrameChangeRef.current = Date.now();
    if (viewerRef.current) viewerRef.current.scene.requestRender();
  }, [frameIndex]);
  useEffect(() => {
    cinematicRef.current = !!activeShot;
    if (onCinematicChange) onCinematicChange(!!activeShot);
  }, [activeShot, onCinematicChange]);

  // rAF render loop: drives Cesium only when something is actually moving
  // (particles on, playback active, or idle auto-orbit), otherwise the scene
  // idles thanks to requestRenderMode.
  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      const viewer = viewerRef.current;
      if (viewer && !viewer.isDestroyed()) {
        const now = Date.now();
        const playing = now - lastFrameChangeRef.current < 2000;
        const particles = showVelocityRef.current;

        // Idle auto-orbit: only during playback, never during the cinematic tour.
        if (
          playing &&
          !cinematicRef.current &&
          now - lastInteractionRef.current > IDLE_ORBIT_DELAY_MS
        ) {
          autoOrbitingRef.current = true;
        }
        if (autoOrbitingRef.current && !cinematicRef.current && orbitCenterRef.current) {
          try {
            const enuFrame = Cesium.Transforms.eastNorthUpToFixedFrame(orbitCenterRef.current);
            viewer.camera.lookAtTransform(enuFrame);
            viewer.camera.rotateRight(0.0009);
            viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
          } catch (e) { /* camera mid-flight */ }
        }

        if (particles || playing || autoOrbitingRef.current) {
          viewer.scene.requestRender();
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      running = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    if (!viewerRef.current || cinematicControllerRef.current) return;
    
    const onShotChange = (shot, isPlaying) => {
      setActiveShot(shot);
      setIsPlayingTour(isPlaying);
      if (shot) {
        // Cinematic owns the frame: close transient panels, kill auto-orbit.
        setShowParticleSettings(false);
        setActivePick(null);
        autoOrbitingRef.current = false;
      }
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

  // Pre-generate flood-surface meshes. Depth-bucketed (shallow/mid/deep) so
  // transparency follows real depth; generated every-4th-frame first so
  // playback can start while the rest fill in behind.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !bounds || !frames || frames.length === 0) return;

    let isMounted = true;

    // One animated-water appearance per depth bucket (shared across frames).
    const bucketAppearances = WATER_BUCKETS.map((b) => {
      const rgba = new Cesium.Color(b.color[0], b.color[1], b.color[2], b.color[3]);
      let material;
      try {
        material = Cesium.Material.fromType("Water", {
          normalMap: Cesium.buildModuleUrl("Assets/Textures/waterNormals.jpg"),
          frequency: 1200.0,
          animationSpeed: 0.03,
          amplitude: 2.5,
          specularIntensity: 0.6,
          baseWaterColor: rgba,
          blendColor: new Cesium.Color(b.color[0] * 0.7, b.color[1] * 0.8, b.color[2], b.color[3]),
        });
      } catch (e) {
        material = Cesium.Material.fromType("Color", { color: rgba });
      }
      return new Cesium.MaterialAppearance({
        material,
        translucent: true,
        materialSupport: Cesium.MaterialAppearance.MaterialSupport.TEXTURED,
      });
    });

    const bucketOf = (d) => {
      for (let k = 0; k < WATER_BUCKETS.length; k++) {
        if (d >= WATER_BUCKETS[k].min && d < WATER_BUCKETS[k].max) return k;
      }
      return -1;
    };

    async function fetchTif(tifPath) {
      if (!tifPath) return null;
      const tifName = tifPath.split("/").pop();
      const res = await fetch(`http://127.0.0.1:8000/simulate/frame/${jobId}/${tifName}`);
      if (!res.ok) return null;
      const buffer = await res.arrayBuffer();
      const tiff = await GeoTIFF.fromArrayBuffer(buffer);
      const image = await tiff.getImage();
      return (await image.readRasters())[0];
    }

    function buildBucketPrimitives(depthData, demData, rows, cols, dLat, dLon) {
      const counts = [0, 0, 0];
      for (let j = 0; j < depthData.length; j++) {
        const bi = bucketOf(depthData[j]);
        if (bi >= 0) counts[bi]++;
      }
      const spanLon = bounds.east - bounds.west;
      const spanLat = bounds.north - bounds.south;
      const ST_TILES = 45;

      return counts.map((n, bi) => {
        if (n === 0) return null;
        const positions = new Float64Array(n * 4 * 3);
        const sts = new Float32Array(n * 4 * 2);
        const indices = new Uint32Array(n * 6);
        let vo = 0;
        let io = 0;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const idx = r * cols + c;
            if (bucketOf(depthData[idx]) !== bi) continue;
            const elev = demData.elevations[idx] + depthData[idx];
            const latN = bounds.north - r * dLat;
            const latS = bounds.north - (r + 1) * dLat;
            const lonW = bounds.west + c * dLon;
            const lonE = bounds.west + (c + 1) * dLon;
            const corners = [
              Cesium.Cartesian3.fromDegrees(lonW, latN, elev),
              Cesium.Cartesian3.fromDegrees(lonE, latN, elev),
              Cesium.Cartesian3.fromDegrees(lonE, latS, elev),
              Cesium.Cartesian3.fromDegrees(lonW, latS, elev),
            ];
            const cornerLL = [[lonW, latN], [lonE, latN], [lonE, latS], [lonW, latS]];
            for (let k = 0; k < 4; k++) {
              positions[(vo + k) * 3] = corners[k].x;
              positions[(vo + k) * 3 + 1] = corners[k].y;
              positions[(vo + k) * 3 + 2] = corners[k].z;
              sts[(vo + k) * 2] = ((cornerLL[k][0] - bounds.west) / spanLon) * ST_TILES;
              sts[(vo + k) * 2 + 1] = ((cornerLL[k][1] - bounds.south) / spanLat) * ST_TILES;
            }
            indices[io] = vo; indices[io + 1] = vo + 3; indices[io + 2] = vo + 1;
            indices[io + 3] = vo + 1; indices[io + 4] = vo + 3; indices[io + 5] = vo + 2;
            vo += 4; io += 6;
          }
        }
        const geometry = new Cesium.Geometry({
          attributes: {
            position: new Cesium.GeometryAttribute({
              componentDatatype: Cesium.ComponentDatatype.DOUBLE,
              componentsPerAttribute: 3,
              values: positions,
            }),
            st: new Cesium.GeometryAttribute({
              componentDatatype: Cesium.ComponentDatatype.FLOAT,
              componentsPerAttribute: 2,
              values: sts,
            }),
          },
          indices,
          primitiveType: Cesium.PrimitiveType.TRIANGLES,
          boundingSphere: Cesium.BoundingSphere.fromVertices(positions),
        });
        Cesium.GeometryPipeline.computeNormal(geometry);
        try {
          Cesium.GeometryPipeline.computeTangentAndBitangent(geometry);
        } catch (e) { /* Color-material fallback doesn't need tangents */ }
        return new Cesium.Primitive({
          geometryInstances: new Cesium.GeometryInstance({ geometry }),
          appearance: bucketAppearances[bi],
          asynchronous: false,
        });
      });
    }

    async function loadAllMeshes() {
      try {
        const demRes = await fetch("http://127.0.0.1:8000/terrain/dem?downsample=1");
        const demData = await demRes.json();
        const { rows, cols } = demData;
        const dLat = (bounds.north - bounds.south) / rows;
        const dLon = (bounds.east - bounds.west) / cols;

        const framesData = new Array(frames.length).fill(null);
        framesDataRef.current = framesData;
        demDataRef.current = demData;

        // Staggered order: every 4th frame first, then the gaps.
        const order = [];
        for (let s = 0; s < 4; s++) {
          for (let i = s; i < frames.length; i += 4) order.push(i);
        }

        let firstPassDone = false;
        for (let oi = 0; oi < order.length; oi++) {
          if (!isMounted) return;
          const i = order[oi];
          const f = frames[i];
          const [depthData, uData, vData] = await Promise.all([
            fetchTif(f.depth_tif), fetchTif(f.u_tif), fetchTif(f.v_tif),
          ]);
          if (!isMounted) return;
          if (depthData) {
            const prims = buildBucketPrimitives(depthData, demData, rows, cols, dLat, dLon);
            prims.forEach((p) => {
              if (p) { p.show = false; viewer.scene.primitives.add(p); }
            });
            framesData[i] = { primitives: prims, depthData, uData, vData };
          }
          if (!firstPassDone && oi >= Math.ceil(frames.length / 4) - 1) {
            firstPassDone = true;
            setMeshesLoaded(true);
            viewer.scene.requestRender();
          }
          // yield to the UI between frames
          await new Promise((res) => setTimeout(res, 0));
        }
        if (isMounted) {
          setMeshesLoaded(true);
          viewer.scene.requestRender();
        }
      } catch (err) {
        console.error("Failed to load 3D flood surfaces:", err);
      }
    }

    loadAllMeshes();

    return () => {
      isMounted = false;
      if (viewer && !viewer.isDestroyed()) {
        framesDataRef.current.forEach((fd) => {
          if (fd && fd.primitives) {
            fd.primitives.forEach((p) => {
              if (p) { try { viewer.scene.primitives.remove(p); } catch (e) { /* gone */ } }
            });
          }
        });
      }
      framesDataRef.current = [];
      setMeshesLoaded(false);
    };
  }, [bounds, frames, jobId]);

  // Sync flood-surface visibility with the timeline
  useEffect(() => {
    framesDataRef.current.forEach((fd, i) => {
      if (fd && fd.primitives) {
        const visible = i === frameIndex && showFlood;
        fd.primitives.forEach((p) => { if (p) p.show = visible; });
      }
    });
    if (viewerRef.current && !viewerRef.current.isDestroyed()) {
      viewerRef.current.scene.requestRender();
    }
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
      if (particleSystemRef.current && showVelocityRef.current) {
        particleSystemRef.current.update(dt, particleSpeed, particleDensity);
        // Keep the scene rendering while particles animate (requestRenderMode).
        viewer.scene.requestRender();
      }
    };

    viewer.scene.preUpdate.addEventListener(onPreUpdate);

    return () => {
      viewer.scene.preUpdate.removeEventListener(onPreUpdate);
    };
  }, [frameIndex, meshesLoaded, bounds, particleSpeed, particleDensity]);

  // Particle-settings popup: close on outside-click or ESC
  useEffect(() => {
    if (!showParticleSettings) return;
    const onKey = (e) => { if (e.key === "Escape") setShowParticleSettings(false); };
    const onDown = (e) => {
      if (particlePopupRef.current && !particlePopupRef.current.contains(e.target)) {
        setShowParticleSettings(false);
      }
    };
    window.addEventListener("keydown", onKey);
    // capture so it fires before Cesium swallows canvas events
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [showParticleSettings]);

  // Sync infrastructure settings
  useEffect(() => {
    if (infraLayerRef.current) {
      infraLayerRef.current.setShowSettlements(infraSettings.showSettlements);
      infraLayerRef.current.setShowRoads(infraSettings.showRoads);
      infraLayerRef.current.setHighlightInundatedOnly(infraSettings.highlightInundated);
    }
  }, [infraSettings]);

  const cinematic = !!activeShot;
  const affected =
    infraStats.submergedSettlements > 0 ||
    infraStats.atRiskSettlements > 0 ||
    infraStats.submergedRoads > 0 ||
    infraStats.atRiskRoads > 0;

  // "Max 3 panels": map + right stats panel + exactly ONE floating info panel.
  // Priority: cinematic card > inspection probe > legend. Live infrastructure
  // impact is folded into the right stats panel (not a separate panel).
  const floatingPanel = cinematic
    ? "cinematic"
    : activePick
      ? "inspection"
      : showFlood || showVelocity
        ? "legend"
        : null;
  const showInfraRows = infraSettings.showSettlements && affected;

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

      {/* HADR Inspection Panel (one floating panel at a time) */}
      {floatingPanel === "inspection" && (
        <InspectionPanel
          pickedData={activePick}
          hydraulics={hydraulics}
          onClose={() => setActivePick(null)}
        />
      )}

      {/* Layer Toggles — compact, collapsible, hidden during the cinematic tour */}
      {!cinematic && !showLayerPanel && (
        <button
          onClick={() => setShowLayerPanel(true)}
          style={{
            position: "absolute", top: 10, right: 10, zIndex: 1000,
            background: "rgba(30,30,30,0.85)", color: "white",
            border: "1px solid rgba(255,255,255,0.2)", borderRadius: "6px",
            padding: "8px 12px", cursor: "pointer", fontSize: "13px",
            backdropFilter: "blur(4px)",
          }}
        >
          ☰ Layers
        </button>
      )}
      {!cinematic && showLayerPanel && (
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2px" }}>
          <span style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px", color: "#aaa" }}>Layers</span>
          <button onClick={() => setShowLayerPanel(false)} style={{ background: "none", border: "none", color: "#aaa", cursor: "pointer", fontSize: "14px" }}>×</button>
        </div>
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
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "14px", margin: 0, flex: 1 }}>
            <input
              type="checkbox"
              checked={showVelocity}
              onChange={(e) => setShowVelocity(e.target.checked)}
              style={{ margin: 0, width: "16px", height: "16px", cursor: "pointer" }}
            />
            Velocity Flow Particles
          </label>
          <button
            title="Particle density & speed"
            onClick={() => setShowParticleSettings((v) => !v)}
            disabled={!showVelocity}
            style={{
              background: showParticleSettings ? "#4a90ff" : "rgba(255,255,255,0.1)",
              color: "white", border: "none", borderRadius: "4px",
              width: "24px", height: "24px", cursor: showVelocity ? "pointer" : "default",
              opacity: showVelocity ? 1 : 0.4, fontSize: "13px",
            }}
          >
            ⚙
          </button>
        </div>

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
      )}

      {/* Particle settings popup — only on explicit ⚙ click, auto-closes */}
      {showParticleSettings && showVelocity && !cinematic && (
        <div
          ref={particlePopupRef}
          style={{
            position: "absolute", top: 54, right: 220, zIndex: 1100,
            background: "rgba(20,20,20,0.95)", padding: "12px 14px",
            borderRadius: "8px", color: "white", width: "210px",
            border: "1px solid rgba(74,144,255,0.5)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
            <span style={{ fontSize: "11px", textTransform: "uppercase", letterSpacing: "1px", color: "#aaa" }}>Particle Settings</span>
            <button onClick={() => setShowParticleSettings(false)} style={{ background: "none", border: "none", color: "#aaa", cursor: "pointer", fontSize: "14px" }}>×</button>
          </div>
          <label style={{ fontSize: "12px", display: "flex", justifyContent: "space-between" }}>
            <span>Density</span><span>{particleDensity}</span>
          </label>
          <input type="range" min="300" max="8000" step="100" value={particleDensity}
            onChange={(e) => setParticleDensity(Number(e.target.value))} style={{ width: "100%", marginBottom: "8px" }} />
          <label style={{ fontSize: "12px", display: "flex", justifyContent: "space-between" }}>
            <span>Speed</span><span>{particleSpeed}x</span>
          </label>
          <input type="range" min="0.1" max="5.0" step="0.1" value={particleSpeed}
            onChange={(e) => setParticleSpeed(Number(e.target.value))} style={{ width: "100%" }} />
        </div>
      )}

      {/* Flood Stats Overlay — the persistent "right stats panel" (kept during cinematic) */}
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

          {/* Live infrastructure impact — folded in, only when something is hit */}
          {showInfraRows && (
            <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(255,255,255,0.15)", fontSize: "12px" }}>
              <div style={{ color: "#ff9f1c", fontWeight: 600, fontSize: "10px", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "5px" }}>
                Infrastructure impact
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                <span>Settlements submerged / at risk</span>
                <strong>{infraStats.submergedSettlements} / {infraStats.atRiskSettlements}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px" }}>
                <span>Roads submerged / at risk</span>
                <strong>{infraStats.submergedRoads ?? 0} / {infraStats.atRiskRoads ?? 0}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", color: "#ff6b6b" }}>
                <span>Population at risk</span>
                <strong>{infraStats.populationAtRisk.toLocaleString()}</strong>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Single merged legend: depth section always, velocity section when on */}
      {floatingPanel === "legend" && (
        <div
          style={{
            position: "absolute",
            bottom: 15,
            right: 15,
            zIndex: 1000,
            background: "rgba(20,20,20,0.88)",
            padding: "12px 16px",
            borderRadius: "8px",
            color: "white",
            border: "1px solid rgba(255,255,255,0.15)",
            backdropFilter: "blur(4px)",
            fontSize: "12px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
            width: "270px"
          }}
        >
          {showFlood && (
            <>
              <div style={{ marginBottom: "6px", fontWeight: "600", color: "#ddd" }}>Modeled Water Depth</div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px", color: "#aaa" }}>
                <span>0.1 m</span><span>0.5 m</span><span>2 m</span><span>&gt; 5 m</span>
              </div>
              <div style={{ height: "6px", width: "100%", borderRadius: "3px", marginBottom: "4px",
                background: "linear-gradient(90deg, rgba(77,158,242,0.4), rgb(33,115,230), rgb(13,51,140), rgb(13,40,90))" }} />
              <div style={{ color: "#aaa", fontSize: "11px" }}>Shallow → translucent · deep → opaque</div>
            </>
          )}
          {showFlood && showVelocity && (
            <div style={{ height: "1px", background: "rgba(255,255,255,0.15)", margin: "10px 0" }} />
          )}
          {showVelocity && (
            <>
              <div style={{ marginBottom: "6px", fontWeight: "600", color: "#ddd" }}>SWE Field Velocity</div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px", color: "#aaa" }}>
                <span>0.0</span><span>2.0</span><span>3.5+ m/s</span>
              </div>
              <div style={{ height: "6px", width: "100%", borderRadius: "3px", marginBottom: "4px",
                background: "linear-gradient(90deg, cyan, yellow, orange, red)" }} />
              <div style={{ color: "#ff6b6b", fontSize: "11px", fontStyle: "italic" }}>Near-field SPH peak: 11.9 m/s</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
