import * as Cesium from "cesium";

export const TOUR_SHOTS = [
  {
    id: 1,
    title: "Regional Overview",
    description: "Full Kosi River basin overview before failure. The embankment is still intact.",
    telemetry: "Discharge: 3,675 m³/s (Pre-breach)",
    physics: "SWE Regional Routing",
    duration: 8000, // ms
    target: {
      lon: 86.98,
      lat: 26.55,
      alt: 45000,
      pitch: -60,
      heading: 0,
    },
    actions: {
      frameIndex: 0,
    }
  },
  {
    id: 2,
    title: "Breach Initiation (Near-field)",
    description: "Paschim Kusaha embankment breach locus. The river begins to overtop and erode the structure.",
    telemetry: "Discharge: 3,675 m³/s (Breach initiated)",
    physics: "Dynamic coupling (SWE)",
    duration: 7000,
    target: {
      lon: 87.050,
      lat: 26.620,
      alt: 1800,
      pitch: -30,
      heading: 160,
    },
    actions: {
      frameIndex: 4,
    }
  },
  {
    id: 3,
    title: "SPH vs SWE Velocity Dynamics",
    description: "High-velocity jet (9.5–11.9 m/s SPH vena-contracta vs 1.4–3.9 m/s SWE). Notice the extreme turbulence at the breach mouth.",
    telemetry: "Peak Velocity: 11.9 m/s",
    physics: "WCSPH Jet Dynamics vs SWE Regional Routing",
    duration: 7000,
    target: {
      lon: 87.052,
      lat: 26.615,
      alt: 900,
      pitch: -20,
      heading: 185,
    },
    actions: {
      showVelocity: true,
    }
  },
  {
    id: 4,
    title: "Downstream Flood Wave Propagation",
    description: "Tracking the hydrodynamic wave front spreading across the low-gradient alluvial cone.",
    telemetry: "Wave Front Celerity: 1.8 m/s",
    physics: "SWE Flow Routing",
    duration: 8000,
    target: {
      lon: 87.02,
      lat: 26.45,
      alt: 12000,
      pitch: -45,
      heading: 190,
    },
    actions: {
      frameIndex: 10,
    }
  },
  {
    id: 5,
    title: "Settlement Vulnerability & Inundation",
    description: "Close inspection of inundated settlements. Red indicators highlight locations where depth exceeds 0.3m.",
    telemetry: "7 critical nodes ≥ 0.3m. 23,743 population at risk.",
    physics: "Inundation Impact Overlay",
    duration: 8000,
    target: {
      lon: 87.03,
      lat: 26.48,
      alt: 3500,
      pitch: -35,
      heading: 220,
    },
    actions: {
      frameIndex: 16, // Peak flood
      highlightInundated: true,
      showSettlements: true,
    }
  },
  {
    id: 6,
    title: "CWC Barrage & Digital Twin Sync",
    description: "CWC station 062-MGD4PTN (gauge level 75.23m). Demonstrates live telemetry integration.",
    telemetry: "Gauge Level: 75.23m",
    physics: "Telemetry Sync",
    duration: 7000,
    target: {
      lon: 86.920,
      lat: 26.520,
      alt: 2200,
      pitch: -25,
      heading: 75,
    },
    actions: {
      showLiveTwinBadge: true,
    }
  },
  {
    id: 7,
    title: "HADR Full Impact Extent (Bird's Eye)",
    description: "Complete final inundation envelope (116.93 km²), SAR validation overlay comparison.",
    telemetry: "Total Inundated Area: 116.93 km²",
    physics: "SAR Validation Comparison",
    duration: 9000,
    target: {
      lon: 87.00,
      lat: 26.50,
      alt: 32000,
      pitch: -85,
      heading: 0,
    },
    actions: {
      // Assuming parent handles SAR, or we just notify
      showSarOverlay: true,
    }
  }
];

export class CinematicTourController {
  constructor(viewer, onShotChange, onTourPause) {
    this.viewer = viewer;
    this.onShotChange = onShotChange;
    this.onTourPause = onTourPause;
    
    this.currentShotIndex = 0;
    this.isPlaying = false;
    this.timeoutId = null;

    // Interrupt handlers
    this.handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    this.handler.setInputAction(() => this._interrupt(), Cesium.ScreenSpaceEventType.LEFT_DOWN);
    this.handler.setInputAction(() => this._interrupt(), Cesium.ScreenSpaceEventType.WHEEL);
    this.handler.setInputAction(() => this._interrupt(), Cesium.ScreenSpaceEventType.MIDDLE_DOWN);
    this.handler.setInputAction(() => this._interrupt(), Cesium.ScreenSpaceEventType.RIGHT_DOWN);
    this.handler.setInputAction(() => this._interrupt(), Cesium.ScreenSpaceEventType.PINCH_START);
  }

  _interrupt() {
    if (this.isPlaying) {
      this.pauseTour();
    }
  }

  startTour() {
    this.currentShotIndex = 0;
    this.resumeTour();
  }

  resumeTour() {
    if (this.currentShotIndex >= TOUR_SHOTS.length) {
      this.currentShotIndex = 0;
    }
    this.isPlaying = true;
    this.executeShot(this.currentShotIndex);
  }

  pauseTour() {
    this.isPlaying = false;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.viewer && !this.viewer.isDestroyed() && this.viewer.camera) {
      this.viewer.camera.cancelFlight();
    }
    if (this.onTourPause) this.onTourPause();
  }

  stopTour() {
    this.pauseTour();
    this.currentShotIndex = 0;
    if (this.onShotChange) this.onShotChange(null, false);
  }

  skipToShot(index) {
    this.currentShotIndex = index;
    if (this.isPlaying) {
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
      this.viewer.camera.cancelFlight();
      this.executeShot(this.currentShotIndex);
    } else {
      // Just fly to it and trigger the actions, but remain paused
      this.flyToShot(this.currentShotIndex, () => {
        const shot = TOUR_SHOTS[this.currentShotIndex];
        if (this.onShotChange) this.onShotChange(shot, false);
      });
    }
  }

  flyToShot(index, onComplete) {
    const shot = TOUR_SHOTS[index];
    this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(shot.target.lon, shot.target.lat, shot.target.alt),
      orientation: {
        heading: Cesium.Math.toRadians(shot.target.heading),
        pitch: Cesium.Math.toRadians(shot.target.pitch),
        roll: 0.0,
      },
      duration: 4.0, // standard flight time
      easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
      complete: onComplete
    });
  }

  executeShot(index) {
    if (!this.isPlaying || index >= TOUR_SHOTS.length) {
      if (index >= TOUR_SHOTS.length) {
        this.stopTour();
      }
      return;
    }

    const shot = TOUR_SHOTS[index];
    
    // Notify UI immediately (to show the glass card & trigger specific actions)
    if (this.onShotChange) {
      this.onShotChange(shot, true);
    }

    // Begin flight
    this.flyToShot(index, () => {
      if (!this.isPlaying) return;
      
      // Wait for the remaining duration (duration - flight time)
      const remainingTime = Math.max(0, shot.duration - 4000);
      
      this.timeoutId = setTimeout(() => {
        if (!this.isPlaying) return;
        this.currentShotIndex++;
        this.executeShot(this.currentShotIndex);
      }, remainingTime);
    });
  }

  destroy() {
    this.pauseTour();
    if (this.handler) {
      this.handler.destroy();
      this.handler = null;
    }
  }
}
