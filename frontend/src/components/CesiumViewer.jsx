import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import * as GeoTIFF from "geotiff";

// Cesium's own Ion-hosted terrain (ion asset 1) works out of the box against
// the default access token the `cesium` npm package ships with -- that's
// what "default world terrain" means here. No ion account/token of our own
// has been set up; a later phase revisits whether that's needed for our own
// DEM tiles.
//
// Requested in the 1.0-1.5x range: 5x (the old React Three Fiber renderer's
// default) was flagged as making the terrain read as a "miniature model."
const VERTICAL_EXAGGERATION = 1.3;

export default function CesiumViewer({ bounds, frames = [], frameIndex = 0 }) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const [terrainError, setTerrainError] = useState(null);

  const [showSatellite, setShowSatellite] = useState(true);
  const satelliteLayerRef = useRef(null);
  
  const [showFlood, setShowFlood] = useState(true);

  useEffect(() => {
    if (!containerRef.current || viewerRef.current) return;

    const terrain = Cesium.Terrain.fromWorldTerrain({
      // Required for Scene.globe.enableLighting to actually shade the
      // terrain from per-vertex normals rather than a flat approximation.
      requestVertexNormals: true,
      requestWaterMask: false,
    });
    terrain.errorEvent.addEventListener((err) => {
      // A real, surfaced failure -- never silently fall back to a flat
      // globe without saying so.
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

    // Cesium's factory default globe.baseColor is Color(0, 0, 0.5) -- a flat
    // dark navy with zero red/green, so with no imagery layer yet (that's a
    // later phase) sun-shaded terrain has almost no room to visibly vary in
    // brightness and reads as a flat blue-black regardless of real relief.
    // A neutral light grey actually lets the per-fragment lighting show.
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#c9c7bd");

    // enableLighting uses the real sun position for the clock's current
    // time. Left on Cesium's default (JulianDate.now()), that's whatever
    // the real time of day happens to be -- during dev this AOI (~87E) hit
    // real dusk/night and the whole terrain rendered black. Pinning to a
    // fixed mid-morning UTC timestamp keeps the sun angle deterministic and
    // in daylight over the AOI regardless of when the app is actually run.
    // ~09:48 local at 87E (UTC+5:48).
    viewer.clock.currentTime = Cesium.JulianDate.fromIso8601("2026-08-25T04:00:00Z");
    viewer.clock.shouldAnimate = false;

    viewerRef.current = viewer;

    return () => {
      viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  // Separate effect (not folded into the mount effect) so a future bounds
  // change -- e.g. switching case studies -- can re-fly the camera without
  // tearing down and recreating the whole Viewer/terrain.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !bounds) return;
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

  return (
    <div className="cesium-viewer-container" style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {terrainError && (
        <div className="cesium-terrain-error" style={{ position: "absolute", top: 10, left: 10, background: "rgba(255,0,0,0.8)", color: "white", padding: 10, borderRadius: 4, zIndex: 1000 }}>
          Cesium World Terrain failed to load: {terrainError}
        </div>
      )}
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
    </div>
  );
}
