import * as Cesium from "cesium";
import { API_BASE } from "../api";

export class InfrastructureLayer {
  constructor(viewer, bounds) {
    this.viewer = viewer;
    this.bounds = bounds;

    // Primitives
    this.pointCollection = new Cesium.PointPrimitiveCollection();
    this.labelCollection = new Cesium.LabelCollection();
    
    // We add them to a single primitive to control visibility easily
    this.primitives = new Cesium.PrimitiveCollection();
    this.primitives.add(this.pointCollection);
    this.primitives.add(this.labelCollection);
    this.viewer.scene.primitives.add(this.primitives);

    // Data structures
    this.settlements = [];
    this.roads = []; // { positions:[Cartesian3], id, geoCoords:[[lon,lat]], depth, bucket, primitive }
    this.roadPrimitive = null; // Cesium.GroundPolylinePrimitive
    this.roadsAvailable = false;

    // State
    this.showSettlements = true;
    this.showRoads = true;
    this.highlightInundatedOnly = false;
    this.loaded = false;

    // Road hazard colour buckets (see color-coding spec)
    this.ROAD_COLORS = {
      safe: Cesium.Color.fromCssColorString("#e8ecef").withAlpha(0.45),
      atRisk: Cesium.Color.fromCssColorString("#ffb020").withAlpha(0.9),
      submerged: Cesium.Color.fromCssColorString("#dc143c").withAlpha(0.95),
    };

    // Live Stats
    this.stats = {
      totalSettlements: 0,
      submergedSettlements: 0,
      atRiskSettlements: 0,
      populationAtRisk: 0,
      submergedRoads: 0,
      atRiskRoads: 0,
    };
  }

  async loadData() {
    try {
      const res = await fetch(`${API_BASE}/infrastructure/settlements`);
      if (res.ok) {
        const data = await res.json();
        this._buildSettlements(data);
      } else {
        console.warn("Failed to load settlements from /infrastructure/settlements");
      }
    } catch (e) {
      console.error("Error loading infrastructure data:", e);
    }

    // --- Road network ingestion --------------------------------------------
    // Backend /infrastructure/roads handles static-vector / cache / live-Overpass.
    let roadGeojson = null;
    try {
      const roadRes = await fetch(`${API_BASE}/infrastructure/roads`);
      if (roadRes.ok) {
        const j = await roadRes.json();
        if (j && j.features && j.features.length) roadGeojson = j;
      }
    } catch (e) {
      /* road layer stays disabled */
    }

    if (roadGeojson) {
      try {
        this._buildRoads(roadGeojson);
      } catch (e) {
        console.warn("Road layer build failed, toggle stays disabled:", e);
        this.roadsAvailable = false;
      }
    }

    this.loaded = true;
    this.updateVisibility();
  }

  _buildRoads(geojson) {
    const instances = [];

    const pushLine = (coords, props) => {
      if (!coords || coords.length < 2) return;
      const flat = [];
      coords.forEach(([lon, lat]) => flat.push(lon, lat));
      const positions = Cesium.Cartesian3.fromDegreesArray(flat);
      const id = `road_${this.roads.length}`;
      const record = {
        id,
        geoCoords: coords.slice(),
        name: props?.name || "road",
        highway: props?.highway || "road",
        depth: 0,
        bucket: "safe",
      };
      this.roads.push(record);
      instances.push(
        new Cesium.GeometryInstance({
          geometry: new Cesium.GroundPolylineGeometry({ positions, width: 3.0 }),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(this.ROAD_COLORS.safe),
          },
          id,
        })
      );
    };

    geojson.features.forEach((f) => {
      const g = f.geometry;
      if (!g) return;
      if (g.type === "LineString") {
        pushLine(g.coordinates, f.properties);
      } else if (g.type === "MultiLineString") {
        g.coordinates.forEach((line) => pushLine(line, f.properties));
      }
    });

    if (!instances.length) {
      this.roadsAvailable = false;
      return;
    }

    this.roadPrimitive = new Cesium.GroundPolylinePrimitive({
      geometryInstances: instances,
      appearance: new Cesium.PolylineColorAppearance({ translucent: true }),
    });
    this.primitives.add(this.roadPrimitive);
    this.roadsAvailable = true;
  }

  setShowRoads(show) {
    this.showRoads = show;
    if (this.roadPrimitive) this.roadPrimitive.show = show && this.roadsAvailable;
  }

  _roadBucket(depth) {
    if (depth >= 0.3) return "submerged";
    if (depth >= 0.1) return "atRisk";
    return "safe";
  }

  _updateRoads(depthData, demData, rows, cols) {
    if (!this.roadsAvailable || !this.roadPrimitive || !this.roadPrimitive.ready) return;

    const dLat = (this.bounds.north - this.bounds.south) / rows;
    const dLon = (this.bounds.east - this.bounds.west) / cols;

    this.stats.submergedRoads = 0;
    this.stats.atRiskRoads = 0;

    this.roads.forEach((road) => {
      // Sample deepest cell the polyline crosses.
      let maxDepth = 0;
      road.geoCoords.forEach(([lon, lat]) => {
        const c = Math.floor((lon - this.bounds.west) / dLon);
        const r = Math.floor((this.bounds.north - lat) / dLat);
        if (r >= 0 && r < rows && c >= 0 && c < cols) {
          const d = depthData[r * cols + c] || 0;
          if (d > maxDepth) maxDepth = d;
        }
      });
      road.depth = maxDepth;
      const bucket = this._roadBucket(maxDepth);
      road.bucket = bucket;
      if (bucket === "submerged") this.stats.submergedRoads++;
      else if (bucket === "atRisk") this.stats.atRiskRoads++;

      try {
        const attr = this.roadPrimitive.getGeometryInstanceAttributes(road.id);
        if (attr) {
          attr.color = Cesium.ColorGeometryInstanceAttribute.toValue(this.ROAD_COLORS[bucket]);
        }
      } catch (e) {
        /* primitive not ready this frame */
      }
    });
  }

  _buildSettlements(geojson) {
    this.stats.totalSettlements = geojson.features.length;

    geojson.features.forEach((feature) => {
      const coords = feature.geometry.coordinates; // [lon, lat]
      const name = feature.properties.name || feature.properties.name_en || "Unknown";
      const population = feature.properties.population || 0;

      // Calculate approximate elevation later dynamically, or clamp to ground
      // Cesium ClampToGround isn't fully supported on LabelCollection/PointPrimitiveCollection out-of-the-box easily without entities or HeightReference. 
      // But we can use HeightReference.CLAMP_TO_GROUND if we use entities, or we just sample the DEM in `updateTimestep`. 
      // Wait, PointPrimitive doesn't have a HeightReference property. We MUST sample DEM or use a high fixed elevation relative to terrain.
      
      const point = this.pointCollection.add({
        position: Cesium.Cartesian3.fromDegrees(coords[0], coords[1], 100), // temp Z
        color: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1.5,
        pixelSize: 6,
        id: { type: "settlement", name, population, lon: coords[0], lat: coords[1] }
      });

      const label = this.labelCollection.add({
        position: Cesium.Cartesian3.fromDegrees(coords[0], coords[1], 100), // temp Z
        text: name,
        font: "12px sans-serif",
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -15),
        // Only reveal name labels on a close approach so the default (wide,
        // oblique) demo view is not cluttered along the bottom edge.
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 18000),
        id: { type: "settlement", name, population, lon: coords[0], lat: coords[1] }
      });

      this.settlements.push({
        lon: coords[0],
        lat: coords[1],
        name: name,
        population: population,
        pointPrimitive: point,
        labelPrimitive: label,
        isSubmerged: false,
        isAtRisk: false,
        depth: 0,
      });
    });
  }

  setShowSettlements(show) {
    this.showSettlements = show;
    this.updateVisibility();
  }

  setHighlightInundatedOnly(highlight) {
    this.highlightInundatedOnly = highlight;
    this.updateVisibility();
  }

  updateVisibility() {
    if (!this.loaded) return;

    this.primitives.show = this.showSettlements;

    if (this.showSettlements) {
      this.settlements.forEach((s) => {
        if (this.highlightInundatedOnly) {
          const visible = s.isSubmerged || s.isAtRisk;
          s.pointPrimitive.show = visible;
          s.labelPrimitive.show = visible;
        } else {
          s.pointPrimitive.show = true;
          s.labelPrimitive.show = true;
        }
      });
    }
  }

  updateTimestep(depthData, demData, rows, cols) {
    if (!this.loaded || !depthData || !demData) return;

    const dLat = (this.bounds.north - this.bounds.south) / rows;
    const dLon = (this.bounds.east - this.bounds.west) / cols;

    let subCount = 0;
    let riskCount = 0;
    let popAtRisk = 0;

    this.settlements.forEach((s) => {
      // Find grid cell
      const c = Math.floor((s.lon - this.bounds.west) / dLon);
      const r = Math.floor((this.bounds.north - s.lat) / dLat);

      if (r >= 0 && r < rows && c >= 0 && c < cols) {
        const idx = r * cols + c;
        const depth = depthData[idx] || 0;
        const elev = demData.elevations[idx] || 0;

        s.depth = depth;
        s.isSubmerged = depth >= 0.3;
        s.isAtRisk = depth >= 0.1 && depth < 0.3;

        // Clamp to ground dynamically
        const z = elev + (depth > 0 ? depth : 0) + 1.0;
        const cart = Cesium.Cartesian3.fromDegrees(s.lon, s.lat, z);
        s.pointPrimitive.position = cart;
        s.labelPrimitive.position = cart;

        // Styling
        if (s.isSubmerged) {
          s.pointPrimitive.color = Cesium.Color.RED;
          s.pointPrimitive.pixelSize = 10;
          s.labelPrimitive.text = `${s.name} (${depth.toFixed(1)}m)`;
          s.labelPrimitive.fillColor = Cesium.Color.RED;
          subCount++;
          popAtRisk += s.population;
        } else if (s.isAtRisk) {
          s.pointPrimitive.color = Cesium.Color.ORANGE;
          s.pointPrimitive.pixelSize = 8;
          s.labelPrimitive.text = `${s.name} (${depth.toFixed(1)}m)`;
          s.labelPrimitive.fillColor = Cesium.Color.ORANGE;
          riskCount++;
          popAtRisk += s.population;
        } else {
          s.pointPrimitive.color = Cesium.Color.WHITE;
          s.pointPrimitive.pixelSize = 5;
          s.labelPrimitive.text = s.name;
          s.labelPrimitive.fillColor = Cesium.Color.WHITE;
        }
      }
    });

    this.stats.submergedSettlements = subCount;
    this.stats.atRiskSettlements = riskCount;
    this.stats.populationAtRisk = Math.floor(popAtRisk);

    this._updateRoads(depthData, demData, rows, cols);

    this.updateVisibility();
  }

  destroy() {
    this.viewer.scene.primitives.remove(this.primitives);
    this.settlements = [];
  }
}
