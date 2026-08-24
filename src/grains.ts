import * as THREE from "three";
import type { CameraRig } from "./camera";
import { isMobileGarden, wantHighQuality } from "./device";
import type { SandField } from "./sand";
import { GARDEN, type Blocker } from "./types";

/** Visible grit sitting on the mass field. Budget keeps a 60fps mobile path. */
export function grainBudget(): number {
  if (wantHighQuality()) return 150_000;
  if (isMobileGarden()) return 46_000;
  return 140_000;
}

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

/**
 * Packed millimetre grit. A rake scoops the trough and stacks that mass on
 * slumped banks — grooves are valleys of grains, not a thinned carpet.
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
    const cellBudget = Math.floor(this.maxCount * 0.42);
    const spacing = Math.max(0.0013, Math.sqrt((spanX * spanZ) / Math.max(8, cellBudget)));
    const worldSize = spacing * 1.72;

    let n = 0;
    let row = 0;
    for (let z = z0; z <= z1 && n < cellBudget; z += spacing, row++) {
      const rowShift = (row % 2) * spacing * 0.37;
      for (let x = x0 + rowShift; x <= x1 && n < cellBudget; x += spacing) {
        const col = ((x - x0) / spacing) | 0;
        const keep = hash2(row * 29 + 3, col * 17 + 8);
        if (keep < 0.14) continue;
        const hx = hash2(row * 19 + 3, col * 11 + 5);
        const hz = hash2(row * 41 + 7, col * 23 + 2);
        let gx = x + (hx - 0.5) * spacing * 1.12;
        let gz = z + (hz - 0.5) * spacing * 1.12;
        if (gx < x0 || gx > x1 || gz < z0 || gz > z1) continue;
        if (blocked(gx, gz, blockers)) continue;
        const h = sand.sampleHeight(gx, gz);
        if (h < -0.014 && keep < 0.78) continue;
        if (h < -0.006 && keep < 0.48) continue;
        const seed = hash2(row * 17 + 4, col * 13 + 9);
        n = this.pushGrain(n, gx, gz, h, seed, 0);
        const extras = h < -0.008 ? 0 : h > 0.01 ? 2 : 1;
        for (let e = 1; e <= extras && n < cellBudget; e++) {
          const ang = hash2(row + e * 13, col + 31) * Math.PI * 2;
          const rad = spacing * (0.22 + hash2(col + e, row + 11) * 0.38);
          const sx = gx + Math.cos(ang) * rad;
          const sz = gz + Math.sin(ang) * rad;
          if (sx < x0 || sx > x1 || sz < z0 || sz > z1) continue;
          if (blocked(sx, sz, blockers)) continue;
          n = this.pushGrain(n, sx, sz, h, hash2(row + e * 7, col + 19), 0);
        }
      }
    }

    const surface = n;
    for (let i = 0; i < surface && n < this.maxCount; i++) {
      const h = this.hs[i];
      if (h < 0.0025) continue;
      const stacks = h > 0.022 ? 16 : h > 0.014 ? 12 : h > 0.008 ? 8 : 5;
      const dir = sand.sampleDir(this.xs[i], this.zs[i]);
      const px = -dir.z;
      const pz = dir.x;
      const out = h >= 0 ? 1 : -1;
      for (let layer = 1; layer <= stacks && n < this.maxCount; layer++) {
        const seed = hash2(i + 19 + layer * 7, 23);
        const slump = layer * spacing * 0.16 * out;
        const wobble = (seed - 0.5) * spacing * 0.55;
        n = this.pushGrain(
          n,
          this.xs[i] + px * slump + wobble,
          this.zs[i] + pz * slump + (hash2(i + 5, 41 + layer) - 0.5) * spacing * 0.55,
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
    const spacing = Math.max(0.0013, Math.sqrt((spanX * spanZ) / Math.max(8, Math.floor(this.maxCount * 0.42))));
    const n = this.count;
    for (let i = 0; i < n; i++) this.hs[i] = sand.sampleHeight(this.xs[i], this.zs[i]);
    this.writeInstances(spacing * 1.72);
  }

  private writeInstances(worldSize: number): void {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const seed = this.seeds[i];
      const h = this.hs[i];
      const layer = this.layers[i];
      const y = GARDEN.sandY + visualHeight(h) + 0.002 + layer * (worldSize * 0.62 + Math.max(0, h) * 0.08);
      const s = worldSize * (0.78 + seed * 0.28);
      _dummy.position.set(this.xs[i], y, this.zs[i]);
      _dummy.rotation.set(seed * 4.2, seed * 6.1, hash2(i + 3, 17) * 5.4);
      _dummy.scale.set(s * (0.9 + seed * 0.16), s * (0.72 + seed * 0.16), s * (0.88 + hash2(i, 9) * 0.16));
      _dummy.updateMatrix();
      this.mesh.setMatrixAt(i, _dummy.matrix);
      const lift = THREE.MathUtils.clamp(layer * 0.012, 0, 0.08);
      _color.setRGB(0.86 + seed * 0.06 + lift, 0.82 + seed * 0.045 + lift * 0.7, 0.74 + seed * 0.035 + lift * 0.4);
      this.mesh.setColorAt(i, _color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** Expand leftover rake relief so a scooped bank still reads after slump. */
function visualHeight(h: number): number {
  const t = THREE.MathUtils.clamp(h / 0.055, -1, 1);
  const mag = Math.pow(Math.abs(t), 0.48) * 0.17;
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
