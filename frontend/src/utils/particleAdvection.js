import * as Cesium from "cesium";

export class VelocityParticleSystem {
  constructor(viewer, bounds) {
    this.viewer = viewer;
    this.bounds = bounds; // { west, east, north, south }
    this.primitiveCollection = new Cesium.PointPrimitiveCollection();
    this.viewer.scene.primitives.add(this.primitiveCollection);
    this.particles = [];
    this.poolSize = 5000;
    
    // Grid metadata
    this.demData = null;
    this.rows = 0;
    this.cols = 0;
    this.dLat = 0;
    this.dLon = 0;
    
    this.activeDepth = null;
    this.activeU = null;
    this.activeV = null;
    
    this.show = true;
  }

  setGridData(demData, rows, cols) {
    this.demData = demData;
    this.rows = rows;
    this.cols = cols;
    this.dLat = (this.bounds.north - this.bounds.south) / rows;
    this.dLon = (this.bounds.east - this.bounds.west) / cols;
  }

  setFrameData(depthData, uData, vData) {
    this.activeDepth = depthData;
    this.activeU = uData;
    this.activeV = vData;
  }
  
  setShow(show) {
    this.show = show;
    this.primitiveCollection.show = show;
  }

  destroy() {
    this.viewer.scene.primitives.remove(this.primitiveCollection);
    this.particles = [];
  }

  // Gets interpolated U, V, and Depth at a continuous fractional grid coordinate
  _sampleGrid(lon, lat) {
    if (!this.activeDepth || !this.activeU || !this.activeV) return null;
    
    // Calculate fractional grid indices
    const c = (lon - this.bounds.west) / this.dLon - 0.5;
    const r = (this.bounds.north - lat) / this.dLat - 0.5;
    
    if (c < 0 || c >= this.cols - 1 || r < 0 || r >= this.rows - 1) return null;

    const r0 = Math.floor(r);
    const c0 = Math.floor(c);
    const r1 = r0 + 1;
    const c1 = c0 + 1;

    const dr = r - r0;
    const dc = c - c0;

    const w00 = (1 - dr) * (1 - dc);
    const w01 = (1 - dr) * dc;
    const w10 = dr * (1 - dc);
    const w11 = dr * dc;

    const idx00 = r0 * this.cols + c0;
    const idx01 = r0 * this.cols + c1;
    const idx10 = r1 * this.cols + c0;
    const idx11 = r1 * this.cols + c1;

    const d00 = this.activeDepth[idx00];
    const d01 = this.activeDepth[idx01];
    const d10 = this.activeDepth[idx10];
    const d11 = this.activeDepth[idx11];
    
    // If any neighbor is dry, consider the boundary non-navigable
    if (d00 < 0.05 || d01 < 0.05 || d10 < 0.05 || d11 < 0.05) {
      return null;
    }

    const u = w00 * this.activeU[idx00] + w01 * this.activeU[idx01] + w10 * this.activeU[idx10] + w11 * this.activeU[idx11];
    const v = w00 * this.activeV[idx00] + w01 * this.activeV[idx01] + w10 * this.activeV[idx10] + w11 * this.activeV[idx11];
    const depth = w00 * d00 + w01 * d01 + w10 * d10 + w11 * d11;
    
    // Nearest neighbor for DEM elevation (faster, and DEM changes slowly)
    const nearestR = Math.round(r);
    const nearestC = Math.round(c);
    const elev = this.demData.elevations[nearestR * this.cols + nearestC];

    return { u, v, depth, elev };
  }

  _getRandomWetCell() {
    if (!this.activeDepth) return null;
    // Attempt random seeding with a timeout
    for (let attempts = 0; attempts < 50; attempts++) {
      const r = Math.floor(Math.random() * this.rows);
      const c = Math.floor(Math.random() * this.cols);
      const idx = r * this.cols + c;
      if (this.activeDepth[idx] > 0.05) {
        return {
          lon: this.bounds.west + (c + Math.random()) * this.dLon,
          lat: this.bounds.north - (r + Math.random()) * this.dLat
        };
      }
    }
    return null;
  }

  _getColorForSpeed(speed) {
    if (speed < 0.5) return Cesium.Color.CYAN;
    if (speed < 2.0) return Cesium.Color.YELLOW;
    if (speed < 3.5) return Cesium.Color.ORANGE;
    return Cesium.Color.RED;
  }

  update(dt, speedMultiplier = 1.0, activePoolSize = 5000) {
    if (!this.show || !this.activeDepth || !this.activeU || !this.activeV || !this.demData) return;

    // Constrain pool size dynamically
    if (this.particles.length > activePoolSize) {
      const toRemove = this.particles.length - activePoolSize;
      for (let i = 0; i < toRemove; i++) {
        const p = this.particles.pop();
        this.primitiveCollection.remove(p.primitive);
      }
    }

    // Add missing particles up to activePoolSize
    while (this.particles.length < activePoolSize) {
      const point = this.primitiveCollection.add({
        position: Cesium.Cartesian3.ZERO,
        color: Cesium.Color.TRANSPARENT,
        pixelSize: 4.0,
      });
      this.particles.push({
        primitive: point,
        lon: 0,
        lat: 0,
        age: 0,
        lifespan: 0,
        active: false,
      });
    }

    const maxDt = Math.min(dt, 0.1); // Prevent explosions on lag spikes

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];

      if (p.active) {
        p.age += maxDt;
      }

      // Respawn if dead, out of bounds, or newly activated
      if (!p.active || p.age >= p.lifespan) {
        const spawn = this._getRandomWetCell();
        if (spawn) {
          p.lon = spawn.lon;
          p.lat = spawn.lat;
          p.age = 0;
          p.lifespan = 2.0 + Math.random() * 2.0; // 2 to 4 seconds
          p.active = true;
        } else {
          p.active = false;
          p.primitive.color = Cesium.Color.TRANSPARENT;
          continue;
        }
      }

      // Sample grid
      const sample = this._sampleGrid(p.lon, p.lat);
      if (!sample) {
        // Hit dry land or bounds, mark for respawn next frame
        p.active = false;
        p.primitive.color = Cesium.Color.TRANSPARENT;
        continue;
      }

      // Advect particle
      const latRad = (p.lat * Math.PI) / 180.0;
      const dLonSec = sample.u / (111320.0 * Math.cos(latRad));
      const dLatSec = sample.v / 111320.0;

      p.lon += dLonSec * maxDt * speedMultiplier;
      p.lat += dLatSec * maxDt * speedMultiplier;

      // Update appearance
      const speed = Math.sqrt(sample.u * sample.u + sample.v * sample.v);
      const color = this._getColorForSpeed(speed);
      
      // Fade in/out based on age
      const fadeThreshold = 0.5; // Fade over 0.5s
      let alpha = 1.0;
      if (p.age < fadeThreshold) alpha = p.age / fadeThreshold;
      else if (p.lifespan - p.age < fadeThreshold) alpha = (p.lifespan - p.age) / fadeThreshold;
      
      p.primitive.color = color.withAlpha(Math.max(0, alpha));
      
      // Update position with 0.2m Z-offset to prevent z-fighting
      const zElev = sample.elev + sample.depth + 0.2;
      p.primitive.position = Cesium.Cartesian3.fromDegrees(p.lon, p.lat, zElev);
    }
  }
}
