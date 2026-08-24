import * as THREE from "three";
import type { CameraState } from "./types";

/** Closest look-across angle — almost standing in the court. */
export const MIN_ELEV = 0.18;
export const MAX_ELEV = 1.12;
/** Frustum height in world units. Smaller = closer. Grain scale is ~0.5. */
export const MIN_ZOOM = 0.48;
export const MAX_ZOOM = 16;
export const DEFAULT_ZOOM = 4.35;
export const DEFAULT_ELEV = 0.36;
export const CAMERA_NEAR = 0.016;
export const CAMERA_FAR = 72;
const TARGET_Y = 0.045;
const MIN_RADIUS = 2.8;
const MAX_RADIUS = 20;

export class CameraRig {
  readonly camera: THREE.OrthographicCamera;
  readonly target = new THREE.Vector3(0, TARGET_Y, 0.12);
  azimuth = Math.PI / 4;
  elevation = DEFAULT_ELEV;
  zoom = DEFAULT_ZOOM;
  aspect = 1;

  constructor() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, CAMERA_NEAR, CAMERA_FAR);
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
    this.target.x = THREE.MathUtils.clamp(this.target.x, -5.4, 5.4);
    this.target.z = THREE.MathUtils.clamp(this.target.z, -3.6, 3.6);
    this.sync();
  }

  dolly(delta: number): void {
    const next = this.zoom * (1 + delta);
    this.zoom = THREE.MathUtils.clamp(next, MIN_ZOOM, MAX_ZOOM);
    this.sync();
  }

  applyState(state: CameraState): void {
    this.azimuth = state.azimuth;
    this.elevation = THREE.MathUtils.clamp(state.elevation, MIN_ELEV, MAX_ELEV);
    this.zoom = THREE.MathUtils.clamp(state.zoom, MIN_ZOOM, MAX_ZOOM);
    this.target.set(state.tx, TARGET_Y, state.tz);
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
    const radius = this.orbitRadius();
    const cosE = Math.cos(this.elevation);
    this.camera.position.set(
      this.target.x + radius * cosE * Math.sin(this.azimuth),
      this.target.y + radius * Math.sin(this.elevation),
      this.target.z + radius * cosE * Math.cos(this.azimuth),
    );
    this.camera.lookAt(this.target);
    this.camera.near = CAMERA_NEAR;
    this.camera.far = CAMERA_FAR;
    const h = this.zoom;
    const w = this.zoom * this.aspect;
    this.camera.left = -w / 2;
    this.camera.right = w / 2;
    this.camera.top = h / 2;
    this.camera.bottom = -h / 2;
    this.camera.updateProjectionMatrix();
  }

  private orbitRadius(): number {
    const t = THREE.MathUtils.smoothstep(MIN_ZOOM, MAX_ZOOM, this.zoom);
    return THREE.MathUtils.lerp(MIN_RADIUS, MAX_RADIUS, t);
  }
}

