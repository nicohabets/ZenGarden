import * as THREE from "three";
import type { CameraState } from "./types";

const ISO_ELEVATION = Math.atan(1 / Math.SQRT2);
const MIN_ELEV = 0.42;
const MAX_ELEV = 1.18;
const MIN_ZOOM = 6.2;
const MAX_ZOOM = 18;

export class CameraRig {
  readonly camera: THREE.OrthographicCamera;
  readonly target = new THREE.Vector3(0, 0.15, 0);
  azimuth = Math.PI / 4;
  elevation = ISO_ELEVATION;
  zoom = 11.2;
  aspect = 1;

  constructor() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.2, 90);
    this.sync();
  }

  setAspect(aspect: number): void {
    this.aspect = Math.max(0.4, aspect);
    this.sync();
  }

  orbit(dx: number, dy: number): void {
    this.azimuth -= dx * 0.007;
    this.elevation = THREE.MathUtils.clamp(this.elevation + dy * 0.005, MIN_ELEV, MAX_ELEV);
    this.sync();
  }

  pan(dx: number, dz: number): void {
    const sin = Math.sin(this.azimuth);
    const cos = Math.cos(this.azimuth);
    const scale = this.zoom * 0.0022;
    this.target.x += (-dx * cos - dz * sin) * scale;
    this.target.z += (dx * sin - dz * cos) * scale;
    this.target.x = THREE.MathUtils.clamp(this.target.x, -4.5, 4.5);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -4, 4);
    this.sync();
  }

  dolly(delta: number): void {
    this.zoom = THREE.MathUtils.clamp(this.zoom * (1 + delta), MIN_ZOOM, MAX_ZOOM);
    this.sync();
  }

  applyState(state: CameraState): void {
    this.azimuth = state.azimuth;
    this.elevation = THREE.MathUtils.clamp(state.elevation, MIN_ELEV, MAX_ELEV);
    this.zoom = THREE.MathUtils.clamp(state.zoom, MIN_ZOOM, MAX_ZOOM);
    this.target.set(state.tx, 0.15, state.tz);
    this.sync();
  }

  toState(): CameraState {
    return {
      azimuth: this.azimuth,
      elevation: this.elevation,
      zoom: this.zoom,
      tx: this.target.x,
      tz: this.target.z,
    };
  }

  sync(): void {
    const radius = 22;
    const cosE = Math.cos(this.elevation);
    this.camera.position.set(
      this.target.x + radius * cosE * Math.sin(this.azimuth),
      this.target.y + radius * Math.sin(this.elevation),
      this.target.z + radius * cosE * Math.cos(this.azimuth),
    );
    this.camera.lookAt(this.target);
    const h = this.zoom;
    const w = this.zoom * this.aspect;
    this.camera.left = -w / 2;
    this.camera.right = w / 2;
    this.camera.top = h / 2;
    this.camera.bottom = -h / 2;
    this.camera.updateProjectionMatrix();
  }
}
