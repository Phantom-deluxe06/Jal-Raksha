import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
<<<<<<< HEAD
import { frameUrl } from "../api";
=======
import * as GeoTIFF from "geotiff";
>>>>>>> d2a0aa355adbec8daa37c1f3c11a3e60359e3bd1

// Vertical exaggeration: 1.3x keeps the Gangetic floodplain readable
// without making the Himalayan foothills look cartoonish.
const VERTICAL_EXAGGERATION = 1.3;

<<<<<<< HEAD
// Flood surface colours — slightly more opaque than before so the
// extent is actually visible at the overview zoom level.
const FLOOD_STROKE = Cesium.Color.fromCssColorString("#4a90ff");
const FLOOD_FILL   = Cesium.Color.fromCssColorString("#1e90ff").withAlpha(0.65);

// Real settlement locations inside the 2008 Kosi flood extent.
// Coordinates cross-checked against OSM + documented breach location.
const KOSI_SETTLEMENTS = [
  { name: "Kusaha (breach site)", lat: 26.55,  lon: 86.92, breach: true  },
  { name: "झाउधटोल",              lat: 26.48,  lon: 87.01, breach: false },
  { name: "Mejartol",             lat: 26.51,  lon: 86.98, breach: false },
  { name: "Mohanlaltol",          lat: 26.44,  lon: 87.05, breach: false },
  { name: "कोसी",                 lat: 26.58,  lon: 86.90, breach: false },
];

export default function CesiumViewer({ bounds, frame }) {
  const containerRef     = useRef(null);
  const viewerRef        = useRef(null);
  const floodDataSourceRef = useRef(null);
  const [terrainError, setTerrainError] = useState(null);

  // ── MOUNT: create Viewer once ──────────────────────────────────────
=======
export default function CesiumViewer({ bounds, frames = [], frameIndex = 0 }) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const [terrainError, setTerrainError] = useState(null);

  const [showSatellite, setShowSatellite] = useState(true);
  const satelliteLayerRef = useRef(null);
  
  const [showFlood, setShowFlood] = useState(true);

>>>>>>> d2a0aa355adbec8daa37c1f3c11a3e60359e3bd1
  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    const terrain = Cesium.Terrain.fromWorldTerrain({
      requestVertexNormals: true,   // needed for per-vertex lighting
      requestWaterMask:     false,
    });
    terrain.errorEvent.addEventListener((err) => {
      console.error("Cesium World Terrain failed to load:", err);
      setTerrainError(err?.message || String(err));
    });

    const viewer = new Cesium.Viewer(containerRef.current, {
      terrain,
      baseLayer:              false,
      baseLayerPicker:        false,
      geocoder:               false,
      timeline:               false,
      animation:              false,
      homeButton:             true,
      sceneModePicker:        true,
      navigationHelpButton:   false,
      fullscreenButton:       false,
      infoBox:                false,
      selectionIndicator:     false,
    });

    viewer.scene.globe.enableLighting   = true;
    viewer.scene.verticalExaggeration   = VERTICAL_EXAGGERATION;

    // Neutral grey so per-fragment lighting is actually visible
    // (the Cesium default navy base colour swamps everything at low sun).
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#c9c7bd");

    // Pin the sun to mid-morning over the AOI (~87 E, UTC+5:48)
    // so terrain is never rendered in the dark during dev/demo.
    viewer.clock.currentTime  = Cesium.JulianDate.fromIso8601("2026-08-25T04:00:00Z");
    viewer.clock.shouldAnimate = false;

    viewerRef.current = viewer;
    return () => {
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  // ── CAMERA: fly to AOI with a 38° tilt so terrain reads as 3-D ────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !bounds) return;
<<<<<<< HEAD

    // Aim at the centre-south of the bounding box so the Himalayan
    // foothills appear on the horizon rather than being cropped off.
    const centerLon = (bounds.west  + bounds.east)  / 2;
    const centerLat =  bounds.south + (bounds.north - bounds.south) * 0.3;

    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(centerLon, centerLat, 75000),
      orientation: {
        heading: Cesium.Math.toRadians(0),    // north-up
        pitch:   Cesium.Math.toRadians(-38),  // 38° tilt — shows relief
        roll:    0,
      },
      duration: 2,
    });
=======
    // Fit-to-rectangle framing (top-down). This AOI is mostly flat Gangetic
    // floodplain -- the only real relief (the Himalayan foothills, ~41-391m
    // per our own DEM) sits at the northern edge, ~80km from a southern
    // vantage point, so no camera angle that keeps the whole AOI in frame
    // makes it a prominent "establishing shot" -- that's the real geometry,
    // not a rendering gap. Lighting/shading was verified separately at
    // closer range (see Phase 2 report); this framing prioritizes seeing
    // the whole documented AOI on load, which is what was asked for. The
    // relief is one drag away via the normal orbit controls.
    const rectangle = Cesium.Rectangle.fromDegrees(bounds.west, bounds.south, bounds.east, bounds.north);
    viewer.camera.flyTo({ destination: rectangle, duration: 2 });
    
    let isMounted = true;
    
    Cesium.SingleTileImageryProvider.fromUrl("http://127.0.0.1:8000/terrain/satellite", {
      rectangle: rectangle
    }).then(provider => {
      if (!isMounted) return;
      const layer = viewer.imageryLayers.addImageryProvider(provider);
      satelliteLayerRef.current = layer;
      setShowSatellite(s => { 
        layer.show = s; 
        layer.alpha = s ? 1.0 : 0.0;
        return s; 
      });
    }).catch(err => {
      console.error("Failed to load satellite imagery:", err);
    });
    
    return () => {
      isMounted = false;
      if (satelliteLayerRef.current && viewer && !viewer.isDestroyed()) {
        try {
          viewer.imageryLayers.remove(satelliteLayerRef.current);
        } catch(e) {}
        satelliteLayerRef.current = null;
      }
    };
>>>>>>> d2a0aa355adbec8daa37c1f3c11a3e60359e3bd1
  }, [bounds]);
  
  useEffect(() => {
    if (satelliteLayerRef.current) {
      satelliteLayerRef.current.show = showSatellite;
      satelliteLayerRef.current.alpha = showSatellite ? 1.0 : 0.0;
    }
  }, [showSatellite]);

  // Phase 5: Pre-generate all 17 meshes on load
  const [meshesLoaded, setMeshesLoaded] = useState(false);
  const primitivesRef = useRef([]);

  // Phase 6: Velocity Flow Visualization
  const [showVelocity, setShowVelocity] = useState(true);
  const framesDataRef = useRef([]);
  const demDataRef = useRef(null);
  const particleCollectionRef = useRef(null);
  const particlesRef = useRef([]);

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
          material: Cesium.Material.fromType('Color', {
            color: new Cesium.Color(0.12, 0.53, 0.90, 0.6)
          }),
          translucent: true
        });

        const tStartAll = performance.now();
        let totalMemoryBytes = 0;

        const meshPromises = frames.map(async (frame, i) => {
          const fetchTif = async (tifPath) => {
            if (!tifPath) return null;
            const tifName = tifPath.split('/').pop();
            const res = await fetch(`http://127.0.0.1:8000/simulate/frame/kosi_actual2008/${tifName}`);
            const buffer = await res.arrayBuffer();
            const tiff = await GeoTIFF.fromArrayBuffer(buffer);
            const image = await tiff.getImage();
            return (await image.readRasters())[0];
          };

          const [depthData, uData, vData] = await Promise.all([
            fetchTif(frame.depth_tif),
            fetchTif(frame.u_tif),
            fetchTif(frame.v_tif)
          ]);

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
                values: positions
              })
            },
            indices: indices,
            primitiveType: Cesium.PrimitiveType.TRIANGLES,
            boundingSphere: Cesium.BoundingSphere.fromVertices(positions)
          });
          
          Cesium.GeometryPipeline.computeNormal(geometry);

          const instance = new Cesium.GeometryInstance({ geometry });

          const primitive = new Cesium.Primitive({
            geometryInstances: instance,
            appearance: materialAppearance,
            asynchronous: false
          });

          return { primitive, memoryBytes: (numFlooded * 12 * 8) + (numFlooded * 6 * 4), depthData, uData, vData };
        });

        const generatedData = await Promise.all(meshPromises);
        
        if (!isMounted) return;

        generatedData.forEach((data) => {
          if (data) {
            totalMemoryBytes += data.memoryBytes;
            data.primitive.show = false;
            viewer.scene.primitives.add(data.primitive);
            primitives.push(data.primitive);
          } else {
            primitives.push(null);
          }
        });

        const tEndAll = performance.now();
        console.log(`[Phase 5 Profile] Pre-generated ${frames.length} meshes in ${(tEndAll - tStartAll).toFixed(2)}ms`);
        console.log(`[Phase 5 Profile] Estimated Geometry Memory Footprint: ${(totalMemoryBytes / 1024 / 1024).toFixed(2)} MB`);

        if (!isMounted) return;
        primitivesRef.current = primitives;
        framesDataRef.current = generatedData;
        demDataRef.current = demData;
        setMeshesLoaded(true);
      } catch(err) {
        console.error("Failed to load 3D flood surfaces:", err);
      }
    }

    loadAllMeshes();

    return () => {
      isMounted = false;
      if (viewer && !viewer.isDestroyed()) {
        primitivesRef.current.forEach(p => {
          if (p) {
            try { viewer.scene.primitives.remove(p); } catch(e){}
          }
        });
      }
      primitivesRef.current = [];
      setMeshesLoaded(false);
    };
  }, [bounds, frames]);

  // Sync visibility with timeline
  useEffect(() => {
    primitivesRef.current.forEach((primitive, i) => {
      if (primitive) {
        primitive.show = (i === frameIndex) && showFlood;
      }
    });
  }, [frameIndex, showFlood, meshesLoaded]);

  useEffect(() => {
    if (particleCollectionRef.current) {
      particleCollectionRef.current.show = showVelocity;
    }
  }, [showVelocity]);

  // Phase 6: Velocity Flow Visualization
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !meshesLoaded || !framesDataRef.current[frameIndex]) return;

    if (!particleCollectionRef.current) {
      particleCollectionRef.current = new Cesium.PointPrimitiveCollection();
      viewer.scene.primitives.add(particleCollectionRef.current);
    }
    
    const points = particleCollectionRef.current;
    points.removeAll();
    points.show = showVelocity;

    const frameData = framesDataRef.current[frameIndex];
    if (!frameData) return;

    const { depthData, uData, vData } = frameData;
    const demData = demDataRef.current;
    if (!demData) return;

    const { rows, cols } = demData;
    const dLat = (bounds.north - bounds.south) / rows;
    const dLon = (bounds.east - bounds.west) / cols;

    const newParticles = [];

    const getColor = (mag) => {
      if (mag < 0.5) return Cesium.Color.CYAN;
      if (mag < 1.0) return Cesium.Color.YELLOW;
      if (mag < 1.5) return Cesium.Color.ORANGE;
      return Cesium.Color.RED;
    };

    // Seed particles
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const depth = depthData[idx];
        if (depth > 0.1) {
          const u = uData[idx];
          const v = vData[idx];
          const mag = Math.sqrt(u * u + v * v);
          if (mag < 0.01) continue; // Skip practically stationary cells
          
          const lat = bounds.north - (r + 0.5) * dLat;
          const lon = bounds.west + (c + 0.5) * dLon;
          const elev = demData.elevations[idx] + depth + 1.5; // Render slightly above water

          const lifespan = 2.0; // seconds
          const age = Math.random() * lifespan;

          const point = points.add({
            position: Cesium.Cartesian3.fromDegrees(lon, lat, elev),
            color: getColor(mag),
            pixelSize: 5,
          });

          newParticles.push({
            startLon: lon,
            startLat: lat,
            elev: elev,
            currentLon: lon,
            currentLat: lat,
            age: age,
            lifespan: lifespan,
            primitive: point
          });
        }
      }
    }
    particlesRef.current = newParticles;

    let lastTime = performance.now();

    const onPreUpdate = () => {
      if (!points.show) {
        lastTime = performance.now();
        return;
      }
      
      const now = performance.now();
      const dt = (now - lastTime) / 1000.0;
      lastTime = now;
      
      // Limit dt and scale for visualization speed
      const safeDt = Math.min(dt, 0.1) * 3.0; 

      const fData = framesDataRef.current[frameIndex];
      if (!fData) return;
      const { uData: activeU, vData: activeV, depthData: activeDepth } = fData;
      const particles = particlesRef.current;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.age += safeDt;

        if (p.age >= p.lifespan) {
          p.currentLon = p.startLon;
          p.currentLat = p.startLat;
          p.age = 0;
        } else {
          const cIdx = Math.floor((p.currentLon - bounds.west) / dLon);
          const rIdx = Math.floor((bounds.north - p.currentLat) / dLat);
          
          if (rIdx >= 0 && rIdx < rows && cIdx >= 0 && cIdx < cols) {
            const arrIdx = rIdx * cols + cIdx;
            const depth = activeDepth[arrIdx];
            if (depth > 0.1) {
              const u = activeU[arrIdx];
              const v = activeV[arrIdx];
              
              const latRad = p.currentLat * Math.PI / 180.0;
              const dLonSec = u / (111320.0 * Math.cos(latRad));
              const dLatSec = v / 111320.0;

              p.currentLon += dLonSec * safeDt;
              p.currentLat += dLatSec * safeDt;
            } else {
              p.currentLon = p.startLon;
              p.currentLat = p.startLat;
              p.age = 0;
            }
          } else {
            p.currentLon = p.startLon;
            p.currentLat = p.startLat;
            p.age = 0;
          }
        }
        p.primitive.position = Cesium.Cartesian3.fromDegrees(p.currentLon, p.currentLat, p.elev);
      }
    };

    viewer.scene.preUpdate.addEventListener(onPreUpdate);

    return () => {
      viewer.scene.preUpdate.removeEventListener(onPreUpdate);
    };
  }, [frameIndex, meshesLoaded, bounds]); // EXCLUDE showVelocity so it doesn't trigger a full re-seed

  // ── FLOOD LAYER: load GeoJSON for the current frame ───────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    // No frame selected — clear any existing flood surface.
    if (!frame) {
      if (floodDataSourceRef.current) {
        viewer.dataSources.remove(floodDataSourceRef.current, true);
        floodDataSourceRef.current = null;
      }
      return;
    }

    let cancelled = false;

    Cesium.GeoJsonDataSource.load(frameUrl(frame.geojson), {
      stroke:      FLOOD_STROKE,
      fill:        FLOOD_FILL,
      strokeWidth: 2,
      clampToGround: true,
    })
      .then((dataSource) => {
        // Guard against React StrictMode double-mount teardown.
        if (cancelled || viewer.isDestroyed()) {
          if (!viewer.isDestroyed())
            viewer.dataSources.remove(dataSource, true);
          return;
        }

        // Remove the previous frame before adding the new one.
        if (floodDataSourceRef.current)
          viewer.dataSources.remove(floodDataSourceRef.current, true);

        viewer.dataSources.add(dataSource);
        floodDataSourceRef.current = dataSource;

        // FIX 2 — auto-zoom to where the flood actually is.
        // At T+45 min the extent is ~15 km² inside a 6 000 km² AOI,
        // so without this it looks like a tiny dot at the overview zoom.
        if (dataSource.entities.values.length > 0) {
          viewer.flyTo(dataSource, {
            duration: 1.5,
            offset: new Cesium.HeadingPitchRange(
              0,
              Cesium.Math.toRadians(-40),
              50000                           // ~50 km altitude
            ),
          });
        }
      })
      .catch((err) => {
        console.error(`Failed to load flood extent for T+${frame.t_minutes}min:`, err);
      });

    return () => { cancelled = true; };
  }, [frame]);

  // ── SETTLEMENT MARKERS: dots + labels clamped to terrain ──────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    KOSI_SETTLEMENTS.forEach(({ name, lat, lon, breach }) => {
      viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat),

        point: {
          pixelSize:       breach ? 14 : 9,
          color:           breach ? Cesium.Color.RED : Cesium.Color.WHITE,
          outlineColor:    Cesium.Color.BLACK,
          outlineWidth:    2,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          // Always render on top of the flood surface.
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },

        label: {
          text:            name,
          font:            "13px sans-serif",
          fillColor:       Cesium.Color.WHITE,
          outlineColor:    Cesium.Color.BLACK,
          outlineWidth:    2,
          style:           Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset:     new Cesium.Cartesian2(0, -20),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    });

    // No cleanup here — settlements are permanent for this case study.
    // If you later support multiple rivers, call viewer.entities.removeAll()
    // and re-add for the new selection.
  }, []); // runs once after mount

  // ── RENDER ────────────────────────────────────────────────────────
  return (
    <div className="cesium-viewer-container" style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {terrainError && (
        <div className="cesium-terrain-error" style={{ position: "absolute", top: 10, left: 10, background: "rgba(255,0,0,0.8)", color: "white", padding: 10, borderRadius: 4, zIndex: 1000 }}>
          Cesium World Terrain failed to load: {terrainError}
        </div>
      )}
<<<<<<< HEAD

      {frame && (
        <>
          <div className="cesium-flood-stats">
            <div className="cesium-flood-stats-title">
              ACTUAL 2008 KUSAHA BREACH
            </div>
            <div className="cesium-flood-stats-subtitle">
              (documented discharge)
            </div>
            <div className="cesium-flood-stats-time">
              T+{frame.t_minutes} min
            </div>
            <div className="cesium-flood-stats-grid">
              <div>
                <span>Flooded area</span>
                <strong>{frame.flooded_area_km2.toLocaleString()} km²</strong>
              </div>
              <div>
                <span>Max depth</span>
                <strong>{frame.max_depth_m} m</strong>
              </div>
              <div>
                <span>Population at risk</span>
                <strong>{frame.population_at_risk.toLocaleString()}</strong>
              </div>
              <div>
                <span>Significantly affected</span>
                <strong>
                  {frame["population_significantly_affected_gt0.3m"].toLocaleString()}
                </strong>
              </div>
              <div>
                <span>Settlements affected</span>
                <strong>{frame.affected_settlements_count}</strong>
              </div>
            </div>
          </div>

          <div className="cesium-flood-legend">
            <div className="cesium-flood-legend-title">Water depth</div>
            <div className="cesium-flood-legend-row">
              <span className="cesium-flood-legend-swatch affected" />
              &gt;0.1 m = affected
            </div>
            <div className="cesium-flood-legend-row">
              <span className="cesium-flood-legend-swatch significant" />
              &gt;0.3 m = significant
            </div>
          </div>
        </>
      )}
=======
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", position: "absolute", top: 10, right: 10, zIndex: 1000, background: "rgba(30, 30, 30, 0.85)", padding: "10px 14px", borderRadius: "6px", color: "white", border: "1px solid rgba(255,255,255,0.2)", backdropFilter: "blur(4px)" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "14px", fontFamily: "sans-serif", margin: 0 }}>
          <input 
            type="checkbox" 
            checked={showSatellite} 
            onChange={(e) => setShowSatellite(e.target.checked)}
            style={{ margin: 0, width: "16px", height: "16px", cursor: "pointer" }}
          />
          Satellite Imagery
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "14px", fontFamily: "sans-serif", margin: 0 }}>
          <input 
            type="checkbox" 
            checked={showFlood} 
            onChange={(e) => setShowFlood(e.target.checked)}
            style={{ margin: 0, width: "16px", height: "16px", cursor: "pointer" }}
          />
          3D Water Surface
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", fontSize: "14px", fontFamily: "sans-serif", margin: 0 }}>
          <input 
            type="checkbox" 
            checked={showVelocity} 
            onChange={(e) => setShowVelocity(e.target.checked)}
            style={{ margin: 0, width: "16px", height: "16px", cursor: "pointer" }}
          />
          Velocity Flow Particles
        </label>
      </div>
>>>>>>> d2a0aa355adbec8daa37c1f3c11a3e60359e3bd1
    </div>
  );
}
