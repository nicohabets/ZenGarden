import * as THREE from "three";
import type { CameraRig } from "./camera";
import { isMobileGarden, wantHighQuality } from "./device";
import { SAND_HEIGHT_GAIN, type SandField } from "./sand";
import { GARDEN, type Blocker } from "./types";

/** Visible grit sitting on the mass field. Budget keeps a 60fps mobile path. */
export function grainBudget(): number {
  if (wantHighQuality()) return 150_000;
  if (isMobileGarden()) return 46_000;
  return 140_000;
}

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

/** Bank growth in metres so piles stay readable at every zoom. */
const LAYER_H = 0.0068;
const SLUMP = 0.012;

/**
 * Packed millimetre grit. A rake scoops a valley and stacks that mass on
 * slumped banks — grooves are piles of grains, not a thinned carpet.
 */
export class GrainCloud {
  readonly mesh: THREE.InstancedMesh;
  private readonly maxCount: number;
  private count = 0;
  private lastKey = "";
  private lastHeightAt = 0;
  private readonly xs: Float32Array;
  private readonly zs: Float32Array;
  private readonly hs: Float32Array;
  private readonly seeds: Float32Array;
  private readonly layers: Float32Array;

  constructor() {
    this.maxCount = grainBudget();
    this.xs = new Float32Array(this.maxCount);
    this.zs = new Float32Array(this.maxCount);
    this.hs = new Float32Array(this.maxCount);
    this.seeds = new Float32Array(this.maxCount);
    this.layers = new Float32Array(this.maxCount);

    const geo = makeGritGeometry();
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.96,
      metalness: 0,
      envMapIntensity: 0,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.maxCount);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.maxCount * 3), 3);
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.userData.kind = "sand-grains";
  }

  getCount(): number {
    return this.count;
  }

  sync(cam: CameraRig, sand: SandField, blockers: Blocker[], viewH: number, force = false): void {
    const key = `${cam.zoom.toFixed(3)}:${cam.target.x.toFixed(2)}:${cam.target.z.toFixed(2)}:${cam.azimuth.toFixed(2)}:${cam.elevation.toFixed(2)}:${cam.aspect.toFixed(2)}:${viewH | 0}:${blockers.length}`;
    if (force || key !== this.lastKey) {
      this.lastKey = key;
      this.layout(cam, sand, blockers);
      this.lastHeightAt = performance.now();
      return;
    }
    const now = performance.now();
    if (now - this.lastHeightAt > 140) {
      this.lift(sand, cam);
      this.lastHeightAt = now;
    }
  }

  private layout(cam: CameraRig, sand: SandField, blockers: Blocker[]): void {
    const bounds = slantBounds(cam);
    const x0 = Math.max(-GARDEN.width / 2 + 0.03, bounds.x0);
    const x1 = Math.min(GARDEN.width / 2 - 0.03, bounds.x1);
    const z0 = Math.max(-GARDEN.depth / 2 + 0.03, bounds.z0);
    const z1 = Math.min(GARDEN.depth / 2 - 0.03, bounds.z1);
    const spanX = Math.max(0.1, x1 - x0);
    const spanZ = Math.max(0.1, z1 - z0);
    const cellBudget = Math.floor(this.maxCount * 0.4);
    const spacing = Math.max(0.0013, Math.sqrt((spanX * spanZ) / Math.max(8, cellBudget)));
    const worldSize = THREE.MathUtils.clamp(spacing * 1.85, 0.0014, 0.052);

    let n = 0;
    let row = 0;
    for (let z = z0; z <= z1 && n < cellBudget; z += spacing, row++) {
      const rowShift = (row % 2) * spacing * 0.5;
      for (let x = x0 + rowShift; x <= x1 && n < cellBudget; x += spacing) {
        const col = ((x - x0) / spacing) | 0;
        const keep = hash2(row * 29 + 3, col * 17 + 8);
        if (keep < 0.16) continue;
        const hx = hash2(row * 19 + 3, col * 11 + 5);
        const hz = hash2(row * 41 + 7, col * 23 + 2);
        const gx = x + (hx - 0.5) * spacing * 1.65;
        const gz = z + (hz - 0.5) * spacing * 1.65;
        if (gx < x0 || gx > x1 || gz < z0 || gz > z1) continue;
        if (blocked(gx, gz, blockers)) continue;
        const h = sand.sampleVisual(gx, gz);
        if (h < -0.028 && keep < 0.22) continue;
        n = this.pushGrain(n, gx, gz, h, keep, 0);
        if (h > -0.004 && keep > 0.55 && n < cellBudget) {
          const ang = hash2(row + 13, col + 31) * Math.PI * 2;
          const rad = spacing * (0.28 + keep * 0.4);
          const sx = gx + Math.cos(ang) * rad;
          const sz = gz + Math.sin(ang) * rad;
          if (sx >= x0 && sx <= x1 && sz >= z0 && sz <= z1 && !blocked(sx, sz, blockers)) {
            n = this.pushGrain(n, sx, sz, h, hash2(row + 7, col + 19), 0);
          }
        }
      }
    }

    const surface = n;
    for (let i = 0; i < surface && n < this.maxCount; i++) {
      const h = this.hs[i];
      if (h < 0.003) continue;
      const stacks = h > 0.02 ? 18 : h > 0.012 ? 13 : h > 0.007 ? 9 : 5;
      const dir = sand.sampleDir(this.xs[i], this.zs[i]);
      let px = -dir.z;
      let pz = dir.x;
      const plen = Math.hypot(px, pz);
      if (plen < 0.05) {
        px = hash2(i, 3) - 0.5;
        pz = hash2(i, 9) - 0.5;
      } else {
        px /= plen;
        pz /= plen;
      }
      for (let layer = 1; layer <= stacks && n < this.maxCount; layer++) {
        const seed = hash2(i + 19 + layer * 7, 23);
        const slump = layer * SLUMP;
        const wobble = (seed - 0.5) * 0.012;
        n = this.pushGrain(
          n,
          this.xs[i] + px * slump + wobble,
          this.zs[i] + pz * slump + (hash2(i + 5, 41 + layer) - 0.5) * 0.012,
          h,
          seed,
          layer,
        );
      }
    }

    this.count = n;
    this.mesh.count = n;
    this.writeInstances(worldSize);
  }

  private pushGrain(n: number, x: number, z: number, h: number, seed: number, layer: number): number {
    if (n >= this.maxCount) return n;
    this.xs[n] = x;
    this.zs[n] = z;
    this.hs[n] = h;
    this.seeds[n] = seed;
    this.layers[n] = layer;
    return n + 1;
  }

  private lift(sand: SandField, cam: CameraRig): void {
    const bounds = slantBounds(cam);
    const spanX = Math.max(0.1, bounds.x1 - bounds.x0);
    const spanZ = Math.max(0.1, bounds.z1 - bounds.z0);
    const spacing = Math.max(0.0013, Math.sqrt((spanX * spanZ) / Math.max(8, Math.floor(this.maxCount * 0.4))));
    const n = this.count;
    for (let i = 0; i < n; i++) this.hs[i] = sand.sampleVisual(this.xs[i], this.zs[i]);
    this.writeInstances(THREE.MathUtils.clamp(spacing * 1.85, 0.0014, 0.052));
  }

  private writeInstances(worldSize: number): void {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const seed = this.seeds[i];
      const h = this.hs[i];
      const layer = this.layers[i];
      const y =
        GARDEN.sandY +
        Math.max(h * SAND_HEIGHT_GAIN, visualHeight(h)) +
        worldSize * 0.38 +
        layer * LAYER_H;
      const s = worldSize * (0.8 + seed * 0.28);
      _dummy.position.set(this.xs[i], y, this.zs[i]);
      _dummy.rotation.set(seed * 4.2, seed * 6.1, hash2(i + 3, 17) * 5.4);
      _dummy.scale.set(s * (0.9 + seed * 0.16), s * (0.74 + seed * 0.16), s * (0.88 + hash2(i, 9) * 0.16));
      _dummy.updateMatrix();
      this.mesh.setMatrixAt(i, _dummy.matrix);
      const lift = THREE.MathUtils.clamp(layer * 0.008, 0, 0.07);
      _color.setRGB(0.87 + seed * 0.05 + lift, 0.83 + seed * 0.04 + lift * 0.65, 0.75 + seed * 0.03 + lift * 0.35);
      this.mesh.setColorAt(i, _color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** Expand leftover rake relief so a scooped bank still reads after slump. */
function visualHeight(h: number): number {
  const t = THREE.MathUtils.clamp(h / 0.055, -1, 1);
  const mag = Math.pow(Math.abs(t), 0.46) * 0.155;
  return Math.sign(t) * mag;
}

function makeGritGeometry(): THREE.BufferGeometry {
  const segs = isMobileGarden() && !wantHighQuality() ? 5 : 6;
  const rings = isMobileGarden() && !wantHighQuality() ? 4 : 5;
  const geo = new THREE.SphereGeometry(0.5, segs, rings);
  geo.scale(1.0, 0.78, 0.9);
  const pos = geo.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = hash2((x * 31) | 0, (z * 19) | 0);
    pos.setXYZ(i, x * (0.9 + k * 0.14), y * (0.88 + k * 0.16), z * (0.88 + (1 - k) * 0.14));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function slantBounds(cam: CameraRig): { x0: number; z0: number; x1: number; z1: number } {
  const sinE = Math.max(0.2, Math.sin(cam.elevation));
  const halfAlong = (cam.zoom * 0.62) / sinE;
  const halfAcross = cam.zoom * cam.aspect * 0.62;
  const sin = Math.sin(cam.azimuth);
  const cos = Math.cos(cam.azimuth);
  const corners = [
    [-halfAcross, -halfAlong],
    [halfAcross, -halfAlong],
    [-halfAcross, halfAlong],
    [halfAcross, halfAlong],
  ] as const;
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const [across, along] of corners) {
    const x = cam.target.x + across * cos + along * sin;
    const z = cam.target.z - across * sin + along * cos;
    x0 = Math.min(x0, x);
    z0 = Math.min(z0, z);
    x1 = Math.max(x1, x);
    z1 = Math.max(z1, z);
  }
  const pad = Math.max(0.1, cam.zoom * 0.08);
  return { x0: x0 - pad, z0: z0 - pad, x1: x1 + pad, z1: z1 + pad };
}

function blocked(x: number, z: number, blockers: Blocker[]): boolean {
  for (const b of blockers) {
    const dx = x - b.x;
    const dz = z - b.z;
    if (dx * dx + dz * dz < b.r * b.r * 1.15) return true;
  }
  return false;
}

function hash2(x: number, y: number): number {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
