import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";

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
  }, [bounds]);

  return (
    <div className="cesium-viewer-container">
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {terrainError && (
        <div className="cesium-terrain-error">
          Cesium World Terrain failed to load: {terrainError}
        </div>
      )}
    </div>
  );
}
