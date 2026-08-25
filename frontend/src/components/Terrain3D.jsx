import React, { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { CameraControls, Html, useTexture, Environment } from "@react-three/drei";
import { EffectComposer, Bloom, N8AO } from "@react-three/postprocessing";
import * as THREE from "three";
import { fetchDem, satelliteUrl } from "../api";

// 1x1 transparent PNG -- a stable placeholder so useTexture (a hook, so it
// can't be called conditionally) always has a valid URL even when there's
// no flood overlay for the current mode/frame; the water mesh itself is
// only rendered when a real overlayUrl was passed in.
const TRANSPARENT_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const CAMERA_PRESETS = {
  oblique: { pos: [0, 26, 36], target: [0, 2, 0] },
  top: { pos: [0, 48, 0.01], target: [0, 0, 0] },
  side: { pos: [36, 16, 0], target: [0, 2, 0] },
};

function TerrainMesh({
  demData,
  overlayUrl,
  vertExaggeration,
  textureMode,
  breachLatLon,
  bounds,
  onHoverElevation,
}) {
  const meshRef = useRef();
  const waterMeshRef = useRef();

  // Texture loading via drei's useTexture (Suspense-integrated, dedupes
  // through THREE's loading manager) rather than raw `new THREE.TextureLoader()`
  // inside useMemo -- the latter is a network side effect living in a memo
  // factory, which React 18 StrictMode intentionally double-invokes in dev,
  // producing two requests for the same URL with inconsistent CORS mode and
  // a real (not cosmetic) failure: the flood overlay silently never rendered.
  const satTexture = useTexture(satelliteUrl());
  const depthTexture = useTexture(overlayUrl || TRANSPARENT_PIXEL);

  useEffect(() => {
    for (const tex of [satTexture, depthTexture]) {
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearFilter;
    }
  }, [satTexture, depthTexture]);

  const { geometry, waterGeometry, breachPos, topoColors, tintColors } = useMemo(() => {
    if (!demData || !demData.elevations) return {};

    const { rows, cols, elevations, min_elevation, max_elevation } = demData;
    const aspect = cols / rows;
    const w = 40 * aspect;
    const h = 40;

    const geom = new THREE.PlaneGeometry(w, h, cols - 1, rows - 1);
    const waterGeom = new THREE.PlaneGeometry(w, h, cols - 1, rows - 1);

    const pos = geom.attributes.position;
    const waterPos = waterGeom.attributes.position;
    const vivid = new Float32Array(pos.count * 3);
    const tint = new Float32Array(pos.count * 3);

    // Color ramp for topo mode
    const elevRange = Math.max(1, max_elevation - min_elevation);

    for (let i = 0; i < pos.count; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const elevIdx = row * cols + col;
      const elev = elevations[elevIdx] !== undefined ? elevations[elevIdx] : min_elevation;
      // Z displacement in local PlaneGeometry coordinates (scale ~0.015 for realistic topography)
      const normZ = ((elev - min_elevation) / elevRange) * 5.0 * (vertExaggeration / 5);
      pos.setZ(i, normZ);
      waterPos.setZ(i, normZ + 0.05); // slightly above ground to prevent z-fighting

      // Vivid topo color gradient (lush green plains -> yellow-ochre -> brown high ground)
      const t = (elev - min_elevation) / elevRange;
      const color = new THREE.Color();
      if (t < 0.15) {
        color.setHSL(0.33, 0.65, 0.3 + t * 0.4);
      } else if (t < 0.5) {
        color.setHSL(0.14 - (t - 0.15) * 0.1, 0.55, 0.42 + (t - 0.15) * 0.2);
      } else {
        color.setHSL(0.06, 0.5, 0.5 + (t - 0.5) * 0.3);
      }
      vivid[i * 3] = color.r;
      vivid[i * 3 + 1] = color.g;
      vivid[i * 3 + 2] = color.b;

      // Subtle near-white hypsometric tint for satellite mode -- multiplies
      // with the real imagery (three.js combines vertexColors x map) rather
      // than replacing it, so low ground reads a touch cooler/darker and
      // high ground a touch warmer/brighter without discoloring the photo.
      const tc = new THREE.Color();
      tc.setHSL(0.08 - t * 0.1, 0.25, 0.86 + t * 0.12);
      tint[i * 3] = tc.r;
      tint[i * 3 + 1] = tc.g;
      tint[i * 3 + 2] = tc.b;
    }

    geom.setAttribute("color", new THREE.BufferAttribute(vivid, 3));
    geom.computeVertexNormals();
    waterGeom.computeVertexNormals();

    // Compute breach 3D coordinate on the mesh
    let bPos = null;
    if (breachLatLon && bounds) {
      const u = (breachLatLon.lon - bounds.west) / (bounds.east - bounds.west);
      const v = (bounds.north - breachLatLon.lat) / (bounds.north - bounds.south);
      const bx = (u - 0.5) * w;
      const by = (0.5 - v) * h;
      // Find approximate elevation at breach
      const row = Math.floor(v * (rows - 1));
      const col = Math.floor(u * (cols - 1));
      const idx = Math.min(elevations.length - 1, Math.max(0, row * cols + col));
      const bElev = elevations[idx] || min_elevation;
      const bz = (bElev - min_elevation) * 0.05 * vertExaggeration + 0.3;
      bPos = [bx, bz, -by]; // mapped to 3D world coords (X, Y, Z)
    }

    return { geometry: geom, waterGeometry: waterGeom, breachPos: bPos, topoColors: vivid, tintColors: tint };
  }, [demData, vertExaggeration, breachLatLon, bounds]);

  // Swap which vertex-color set is active without rebuilding the whole
  // geometry -- keeps the elevation gradient present (subtly) in both
  // texture modes instead of only existing for "topo".
  useEffect(() => {
    if (!geometry) return;
    const colors = textureMode === "satellite" ? tintColors : topoColors;
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.attributes.color.needsUpdate = true;
  }, [geometry, textureMode, topoColors, tintColors]);

  if (!geometry) return null;

  return (
    <group>
      {/* Base Terrain Mesh */}
      <mesh
        ref={meshRef}
        geometry={geometry}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        castShadow
        onPointerMove={(e) => {
          if (onHoverElevation && e.point) {
            onHoverElevation(e.point);
          }
        }}
      >
        {textureMode === "satellite" ? (
          <meshStandardMaterial
            map={satTexture}
            vertexColors
            roughness={0.92}
            metalness={0}
            side={THREE.DoubleSide}
          />
        ) : (
          <meshStandardMaterial
            vertexColors
            roughness={0.85}
            metalness={0}
            side={THREE.DoubleSide}
          />
        )}
      </mesh>

      {/* Dynamic Flood Overlay Surface -- glossy/reflective water via a
          physical material: clearcoat gives the glassy top-layer sheen,
          ior=1.33 is water's real refractive index (drives Fresnel
          reflectance at grazing angles), while the depth-color texture
          stays the primary diffuse map so the data underneath the sheen
          is still readable. */}
      {overlayUrl && (
        <mesh
          ref={waterMeshRef}
          geometry={waterGeometry}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.02, 0]}
        >
          <meshPhysicalMaterial
            map={depthTexture}
            transparent
            opacity={0.92}
            depthWrite={false}
            roughness={0.2}
            metalness={0.05}
            clearcoat={1}
            clearcoatRoughness={0.12}
            ior={1.33}
            reflectivity={0.6}
            envMapIntensity={1.6}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Breach Site 3D Marker */}
      {breachPos && (
        <group position={breachPos}>
          <mesh position={[0, 1.2, 0]}>
            <coneGeometry args={[0.6, 1.8, 16]} />
            <meshStandardMaterial color="#ff3b30" emissive="#ff1a1a" emissiveIntensity={0.9} />
          </mesh>
          <mesh position={[0, 2.3, 0]}>
            <sphereGeometry args={[0.4, 16, 16]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={1.1} />
          </mesh>
          <Html position={[0, 3.2, 0]} center distanceFactor={25}>
            <div className="terrain3d-pin-label">
              <span>⚠️ Kusaha Breach Site</span>
            </div>
          </Html>
        </group>
      )}
    </group>
  );
}

export default function Terrain3D({
  bounds,
  overlayUrl,
  breachLatLon,
}) {
  const [demData, setDemData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [vertExaggeration, setVertExaggeration] = useState(5);
  const [textureMode, setTextureMode] = useState("satellite"); // "satellite" | "topo"
  const [activePreset, setActivePreset] = useState("oblique");
  const controlsRef = useRef();

  useEffect(() => {
    fetchDem(2) // downsampled 2x for smooth 60fps rendering (~240x210 grid)
      .then((data) => {
        setDemData(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const resetCamera = (viewType) => {
    setActivePreset(viewType);
    const preset = CAMERA_PRESETS[viewType];
    if (!controlsRef.current || !preset) return;
    // CameraControls.setLookAt(..., true) eases to the target over its own
    // internal damping rather than snapping the camera there in one frame.
    controlsRef.current.setLookAt(...preset.pos, ...preset.target, true);
  };

  return (
    <div className="terrain3d-container">
      {/* 3D Controls Header Overlay */}
      <div className="terrain3d-toolbar">
        <div className="toolbar-group">
          <label>Texture:</label>
          <button
            className={textureMode === "satellite" ? "active" : ""}
            onClick={() => setTextureMode("satellite")}
            title="Real Copernicus Sentinel-2 True Colour Imagery"
          >
            🛰️ Sentinel-2
          </button>
          <button
            className={textureMode === "topo" ? "active" : ""}
            onClick={() => setTextureMode("topo")}
            title="SRTM Topographic Elevation Shading"
          >
            ⛰️ Elevation
          </button>
        </div>

        <div className="toolbar-group">
          <label>Exaggeration: <strong>{vertExaggeration}x</strong></label>
          <input
            type="range"
            min="1"
            max="15"
            step="0.5"
            value={vertExaggeration}
            onChange={(e) => setVertExaggeration(Number(e.target.value))}
          />
        </div>


        <div className="toolbar-group camera-views">
          <label>Preset Views:</label>
          <button className={activePreset === "oblique" ? "active" : ""} onClick={() => resetCamera("oblique")}>Perspective 3D</button>
          <button className={activePreset === "top" ? "active" : ""} onClick={() => resetCamera("top")}>Top-Down 2.5D</button>
          <button className={activePreset === "side" ? "active" : ""} onClick={() => resetCamera("side")}>Cross-Section</button>
        </div>
      </div>

      {loading && (
        <div className="terrain3d-loading">
          <div className="spinner"></div>
          <p>Loading real SRTM DEM elevation mesh & Sentinel-2 imagery…</p>
        </div>
      )}

      {error && (
        <div className="terrain3d-error">
          <p>Error loading 3D terrain: {error}</p>
        </div>
      )}

      {!loading && !error && demData && (
        <Canvas
          camera={{ position: [0, 28, 38], fov: 45, near: 0.1, far: 1000 }}
          shadows
          style={{ width: "100%", height: "100%" }}
        >
          <ambientLight intensity={0.38} />
          <directionalLight
            position={[26, 34, 18]}
            intensity={2.0}
            castShadow
            shadow-mapSize={[2048, 2048]}
            shadow-camera-left={-32}
            shadow-camera-right={32}
            shadow-camera-top={32}
            shadow-camera-bottom={-32}
            shadow-camera-near={0.5}
            shadow-camera-far={110}
            shadow-bias={-0.0015}
          />
          <directionalLight position={[-24, 16, -18]} intensity={0.35} color="#8fb4ff" />

          <Suspense fallback={null}>
            <TerrainMesh
              demData={demData}
              overlayUrl={overlayUrl}
              vertExaggeration={vertExaggeration}
              textureMode={textureMode}
              breachLatLon={breachLatLon}
              bounds={bounds}
            />
            <Environment preset="park" background={false} environmentIntensity={0.7} />
          </Suspense>

          <CameraControls
            ref={controlsRef}
            minDistance={5}
            maxDistance={120}
            maxPolarAngle={Math.PI / 2 - 0.05}
            dollySpeed={0.6}
            smoothTime={0.35}
          />

          {/* halfRes + "performance" quality keep this affordable on integrated
              graphics -- full-res AO is a large cost for a subtle effect. */}
          <EffectComposer>
            <N8AO halfRes quality="performance" aoRadius={2.2} intensity={1.4} distanceFalloff={1} />
            <Bloom luminanceThreshold={0.72} luminanceSmoothing={0.3} intensity={0.5} mipmapBlur />
          </EffectComposer>
        </Canvas>
      )}

      {/* 3D Context Badge */}
      <div className="terrain3d-info-badge">
        <div className="badge-row">
          <span className="badge-title">3D Real Terrain Model</span>
          <span className="badge-tag">NASA SRTM 30m DEM + Sentinel-2 L2A</span>
        </div>
        <div className="badge-sub">
          Elevation: {demData ? `${demData.min_elevation.toFixed(1)}m – ${demData.max_elevation.toFixed(1)}m MSL` : "—"} | Grid: {demData ? `${demData.rows}×${demData.cols}` : "—"}
        </div>
        <div className="badge-tip">
          🖱️ Left Click + Drag to Orbit | Right Click to Pan | Scroll to Zoom
        </div>
      </div>
    </div>
  );
}
