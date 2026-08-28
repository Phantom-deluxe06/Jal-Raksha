import * as Cesium from "cesium";

export class HadrInteractionController {
  constructor(viewer, onPick) {
    this.viewer = viewer;
    this.onPick = onPick;
    this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);

    this.handler.setInputAction((click) => {
      this._handleLeftClick(click.position);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  _handleLeftClick(windowPosition) {
    // 1. Try to pick a vector entity first
    const pickedObject = this.viewer.scene.pick(windowPosition);

    if (Cesium.defined(pickedObject) && pickedObject.id) {
      // Picked a vector entity (settlement, road, etc.)
      const metadata = pickedObject.id;
      if (metadata.type) {
        this.onPick({
          isEntity: true,
          type: metadata.type,
          lat: metadata.lat,
          lon: metadata.lon,
          metadata: metadata,
        });
        return;
      }
    }

    // 2. If no vector entity, try to pick the terrain/globe surface
    const ray = this.viewer.camera.getPickRay(windowPosition);
    if (!ray) return;
    
    // Pick against globe (assuming terrain is loaded)
    const cartesian = this.viewer.scene.globe.pick(ray, this.viewer.scene);
    
    if (Cesium.defined(cartesian)) {
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      const lat = Cesium.Math.toDegrees(cartographic.latitude);
      const lon = Cesium.Math.toDegrees(cartographic.longitude);

      this.onPick({
        isEntity: false,
        type: "terrain",
        lat: lat,
        lon: lon,
        metadata: { name: "Custom Coordinate Probe" },
      });
    } else {
      // Clicked in space
      this.onPick(null);
    }
  }

  destroy() {
    if (this.handler && !this.handler.isDestroyed()) {
      this.handler.destroy();
    }
    this.handler = null;
  }
}
