import { useEffect, useRef, useState } from "react";
import * as Cesium from "cesium";
import { frameUrl } from "../api";

// Vertical exaggeration: 1.3x keeps the Gangetic floodplain readable
// without making the Himalayan foothills look cartoonish.
const VERTICAL_EXAGGERATION = 1.3;

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
  }, [bounds]);

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
    <div className="cesium-viewer-container">
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {terrainError && (
        <div className="cesium-terrain-error">
          Cesium World Terrain failed to load: {terrainError}
        </div>
      )}

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
    </div>
  );
}
