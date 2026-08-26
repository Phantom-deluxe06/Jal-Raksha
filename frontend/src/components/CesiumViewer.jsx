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

export default function CesiumViewer({ bounds }) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const [terrainError, setTerrainError] = useState(null);

  const [showSatellite, setShowSatellite] = useState(true);
  const satelliteLayerRef = useRef(null);
  
  const [showFlood, setShowFlood] = useState(true);
  const floodPrimitiveRef = useRef(null);

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

  // Phase 4: 3D Flood Surface
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !bounds) return;

    let isMounted = true;

    async function loadFloodMesh() {
      try {
        const demRes = await fetch("http://127.0.0.1:8000/terrain/dem?downsample=1");
        const demData = await demRes.json();
        
        const tifRes = await fetch("http://127.0.0.1:8000/simulate/frame/kosi_actual2008/depth_t0120.tif");
        const tifBuffer = await tifRes.arrayBuffer();
        const tiff = await GeoTIFF.fromArrayBuffer(tifBuffer);
        const image = await tiff.getImage();
        const depthData = (await image.readRasters())[0];

        if (!isMounted) return;

        const { rows, cols } = demData;
        const dLat = (bounds.north - bounds.south) / rows;
        const dLon = (bounds.east - bounds.west) / cols;

        let numFlooded = 0;
        for (let i = 0; i < depthData.length; i++) {
          if (depthData[i] > 0.1) numFlooded++;
        }

        if (numFlooded === 0) return;

        const tStart = performance.now();

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
          appearance: new Cesium.MaterialAppearance({
            material: Cesium.Material.fromType('Color', {
              color: new Cesium.Color(0.12, 0.53, 0.90, 0.6)
            }),
            translucent: true
          }),
          asynchronous: false // Sync creation blocks UI but guarantees rendering order in some cases.
        });

        floodPrimitiveRef.current = viewer.scene.primitives.add(primitive);
        setShowFlood(s => { primitive.show = s; return s; });
        
        const tEnd = performance.now();
        console.log(`[Phase 4 Profile] 3D Flood Mesh Generation: ${(tEnd - tStart).toFixed(2)}ms for ${numFlooded} flooded cells.`);

      } catch(err) {
        console.error("Failed to load 3D flood surface:", err);
      }
    }

    loadFloodMesh();

    return () => {
      isMounted = false;
      if (floodPrimitiveRef.current && viewer && !viewer.isDestroyed()) {
        try { viewer.scene.primitives.remove(floodPrimitiveRef.current); } catch(e){}
        floodPrimitiveRef.current = null;
      }
    };
  }, [bounds]);

  useEffect(() => {
    if (floodPrimitiveRef.current) {
      floodPrimitiveRef.current.show = showFlood;
    }
  }, [showFlood]);

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
      </div>
    </div>
  );
}
