import React, { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import { fetchDem, satelliteUrl } from "../api";

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

  // Load Satellite Texture
  const satTexture = useMemo(() => {
    const loader = new THREE.TextureLoader();
    const tex = loader.load(satelliteUrl());
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }, []);

  // Load Depth Overlay Texture if provided
  const depthTexture = useMemo(() => {
    if (!overlayUrl) return null;
    const loader = new THREE.TextureLoader();
    const tex = loader.load(overlayUrl);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }, [overlayUrl]);


  const { geometry, waterGeometry, breachPos } = useMemo(() => {
    if (!demData || !demData.elevations) return {};

    const { rows, cols, elevations, min_elevation, max_elevation } = demData;
    const aspect = cols / rows;
    const w = 40 * aspect;
    const h = 40;

    const geom = new THREE.PlaneGeometry(w, h, cols - 1, rows - 1);
    const waterGeom = new THREE.PlaneGeometry(w, h, cols - 1, rows - 1);

    const pos = geom.attributes.position;
    const waterPos = waterGeom.attributes.position;
    const colors = new Float32Array(pos.count * 3);

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

      // Topo color gradient (lush green plains -> yellow-ochre -> brown high ground)
      const t = (elev - min_elevation) / elevRange;
      const color = new THREE.Color();
      if (t < 0.15) {
        color.setHSL(0.33, 0.65, 0.3 + t * 0.4);
      } else if (t < 0.5) {
        color.setHSL(0.14 - (t - 0.15) * 0.1, 0.55, 0.42 + (t - 0.15) * 0.2);
      } else {
        color.setHSL(0.06, 0.5, 0.5 + (t - 0.5) * 0.3);
      }
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }


    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
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

    return { geometry: geom, waterGeometry: waterGeom, breachPos: bPos };
  }, [demData, vertExaggeration, breachLatLon, bounds]);

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
            roughness={0.85}
            metalness={0.05}
            side={THREE.DoubleSide}
          />
        ) : (
          <meshStandardMaterial
            vertexColors
            roughness={0.75}
            metalness={0.1}
            side={THREE.DoubleSide}
          />
        )}
      </mesh>

      {/* Dynamic Flood Overlay Surface */}
      {depthTexture && (
        <mesh
          ref={waterMeshRef}
          geometry={waterGeometry}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, 0.02, 0]}
        >
          <meshStandardMaterial
            map={depthTexture}
            transparent={true}
            opacity={0.88}
            depthWrite={false}
            roughness={0.1}
            metalness={0.6}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}

      {/* Breach Site 3D Marker */}
      {breachPos && (
        <group position={breachPos}>
          <mesh position={[0, 1.2, 0]}>
            <coneGeometry args={[0.6, 1.8, 16]} />
            <meshStandardMaterial color="#ff3b30" emissive="#ff1a1a" emissiveIntensity={0.6} />
          </mesh>
          <mesh position={[0, 2.3, 0]}>
            <sphereGeometry args={[0.4, 16, 16]} />
            <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.8} />
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
    if (!controlsRef.current) return;
    if (viewType === "top") {
      controlsRef.current.object.position.set(0, 48, 0.01);
      controlsRef.current.target.set(0, 0, 0);
    } else if (viewType === "oblique") {
      controlsRef.current.object.position.set(0, 26, 36);
      controlsRef.current.target.set(0, 2, 0);
    } else if (viewType === "side") {
      controlsRef.current.object.position.set(36, 16, 0);
      controlsRef.current.target.set(0, 2, 0);
    }
    controlsRef.current.update();
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
          <button onClick={() => resetCamera("oblique")}>Perspective 3D</button>
          <button onClick={() => resetCamera("top")}>Top-Down 2.5D</button>
          <button onClick={() => resetCamera("side")}>Cross-Section</button>
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
          style={{ width: "100%", height: "100%", background: "#0b0f17" }}
        >
          <ambientLight intensity={0.75} />
          <directionalLight
            position={[30, 45, 20]}
            intensity={1.4}
            castShadow
            shadow-mapSize={[2048, 2048]}
          />
          <directionalLight position={[-30, 20, -20]} intensity={0.4} />

          <Suspense fallback={null}>
            <TerrainMesh
              demData={demData}
              overlayUrl={overlayUrl}
              vertExaggeration={vertExaggeration}
              textureMode={textureMode}
              breachLatLon={breachLatLon}
              bounds={bounds}
            />
          </Suspense>

          <OrbitControls
            ref={controlsRef}
            enableDamping
            dampingFactor={0.05}
            maxDistance={120}
            minDistance={5}
            maxPolarAngle={Math.PI / 2 - 0.05} // prevent going underneath terrain
          />
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

