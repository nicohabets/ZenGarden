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
const LAYER_H = 0.0024;
const SLUMP = 0.0075;

/**
 * Packed millimetre grit. A rake scoops a valley and stacks that mass on
 * slumped banks — the trough stays a thinner sandy bed, never a bare slab.
 */
export class GrainCloud {
  readonly mesh: THREE.InstancedMesh;
  private readonly maxCount: number;
  private count = 0;
  private lastKey = "";
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
      color: 0xffffff,
      roughness: 0.94,
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
    const hq = wantHighQuality();
    const close = cam.zoom < 1.15;
    const cellBudget = Math.floor(this.maxCount * (close ? (hq ? 0.82 : 0.76) : 0.64));
    const spacing = Math.max(0.00105, Math.sqrt((spanX * spanZ) / Math.max(8, cellBudget)));
    const worldSize = close
      ? Math.min(spacing * 1.16, hq ? 0.0035 : 0.0064)
      : Math.min(spacing * 0.48, hq ? 0.01 : 0.012);

    let n = 0;
    let row = 0;
    const jitter = hq && cam.zoom < 1.25 ? 0.22 : 0.38;
    for (let z = z0; z <= z1 && n < cellBudget; z += spacing, row++) {
      const rowShift = (row % 2) * spacing * 0.5;
      for (let x = x0 + rowShift; x <= x1 && n < cellBudget; x += spacing) {
        const col = ((x - x0) / spacing) | 0;
        const hx = hash2(row * 19 + 3, col * 11 + 5);
        const hz = hash2(row * 41 + 7, col * 23 + 2);
        const gx = x + (hx - 0.5) * spacing * jitter;
        const gz = z + (hz - 0.5) * spacing * jitter;
        if (gx < x0 || gx > x1 || gz < z0 || gz > z1) continue;
        if (blocked(gx, gz, blockers)) continue;
        const mass = hq ? sand.sampleVisual(gx, gz) : sand.sampleHeight(gx, gz);
        n = this.pushGrain(n, gx, gz, mass, hx, 0);
        if (hq && mass < -0.006 && n < cellBudget) {
          const ox = gx + (hz - 0.5) * spacing * 0.4;
          const oz = gz + (hx - 0.5) * spacing * 0.4;
          if (!blocked(ox, oz, blockers)) n = this.pushGrain(n, ox, oz, mass, hz, 1);
        }
      }
    }

    const pathStep = hq ? Math.max(spacing * 0.65, 0.0035) : Math.max(0.024, spacing);
    const troughCap = Math.floor(this.maxCount * (hq ? 0.88 : 0.82));
    const troughHalf = hq ? 0.058 : 0.032;
    const troughStep = Math.max(spacing * 0.7, hq ? 0.0022 : 0.01);
    sand.forEachTrough(x0, z0, x1, z1, pathStep, (x, z, tx, tz) => {
      if (n >= troughCap) return;
      const across = Math.hypot(tx, tz) || 1;
      const nx = -tz / across;
      const nz = tx / across;
      for (let k = -troughHalf; k <= troughHalf && n < troughCap; k += troughStep) {
        const gx = x + nx * k + (hash2((x * 67 + k * 40) | 0, 3) - 0.5) * spacing * 0.28;
        const gz = z + nz * k + (hash2(5, (z * 83 + k * 40) | 0) - 0.5) * spacing * 0.28;
        if (blocked(gx, gz, blockers)) continue;
        const mass = hq ? sand.sampleVisual(gx, gz) : sand.sampleHeight(gx, gz);
        n = this.pushGrain(n, gx, gz, mass, hash2((gx * 90) | 0, (gz * 90) | 0), 0);
      }
    });

    const surface = n;
    const stackCap = Math.floor(this.maxCount * 0.94);
    for (let i = 0; i < surface && n < stackCap; i++) {
      const h = this.hs[i];
      if (h < 0.003) continue;
      const stacks = hq
        ? h > 0.02
          ? 8
          : h > 0.012
            ? 6
            : h > 0.007
              ? 4
              : 3
        : h > 0.02
          ? 5
          : h > 0.012
            ? 3
            : 2;
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
      for (let layer = 1; layer <= stacks && n < stackCap; layer++) {
        const seed = hash2(i + 19 + layer * 7, 23);
        const slump = layer * SLUMP;
        const ox = this.xs[i] + px * slump + (seed - 0.5) * 0.008;
        const oz = this.zs[i] + pz * slump + (hash2(i + 5, 41 + layer) - 0.5) * 0.008;
        if (blocked(ox, oz, blockers)) continue;
        n = this.pushGrain(n, ox, oz, h, seed, layer);
      }
    }

    const bankLayers = hq ? 5 : 3;
    sand.forEachBank(x0, z0, x1, z1, pathStep, (x, z, tx, tz, h) => {
      if (n >= this.maxCount) return;
      const across = Math.hypot(tx, tz) || 1;
      const nx = -tz / across;
      const nz = tx / across;
      const seed = hash2((x * 73) | 0, (z * 91) | 0);
      const bx = x + (seed - 0.5) * spacing * 0.28;
      const bz = z + (hash2((z * 91) | 0, 5) - 0.5) * spacing * 0.28;
      if (!blocked(bx, bz, blockers)) {
        n = this.pushGrain(n, bx, bz, Math.max(h, sand.sampleHeight(bx, bz)), seed, 0);
      }
      for (let layer = 1; layer <= bankLayers && n < this.maxCount; layer++) {
        const s = hash2(((x * 41) | 0) + layer, ((z * 37) | 0) + 11);
        const ox = x + nx * layer * SLUMP * 0.4 + (s - 0.5) * spacing * 0.22;
        const oz = z + nz * layer * SLUMP * 0.4 + (hash2(layer + 3, 19) - 0.5) * spacing * 0.22;
        if (blocked(ox, oz, blockers)) continue;
        n = this.pushGrain(n, ox, oz, h, s, layer);
      }
    });

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

  private writeInstances(worldSize: number): void {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const seed = this.seeds[i];
      const h = this.hs[i];
      const layer = this.layers[i];
      const floor = h * SAND_HEIGHT_GAIN;
      const pile = h > 0.002 ? visualHeight(h) : 0;
      const y = GARDEN.sandY + floor + pile + worldSize * 0.55 + layer * LAYER_H + 0.0014;
      const s = worldSize * (0.84 + seed * 0.24);
      _dummy.position.set(this.xs[i], y, this.zs[i]);
      _dummy.rotation.set(seed * 6.2, seed * 8.1, hash2(i + 3, 17) * 6.8);
      _dummy.scale.set(s * (0.78 + seed * 0.36), s * (0.4 + seed * 0.22), s * (0.62 + hash2(i, 9) * 0.4));
      _dummy.updateMatrix();
      this.mesh.setMatrixAt(i, _dummy.matrix);
      const lift = THREE.MathUtils.clamp(layer * 0.016, 0, 0.06);
      _color.setRGB(0.8 + seed * 0.08 + lift, 0.76 + seed * 0.06 + lift * 0.5, 0.68 + seed * 0.05 + lift * 0.28);
      this.mesh.setColorAt(i, _color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** Expand leftover rake relief so a scooped bank still reads after slump. */
function visualHeight(h: number): number {
  const t = THREE.MathUtils.clamp(h / 0.055, 0, 1);
  return Math.pow(t, 0.55) * 0.042;
}

/** Angular chip — dry grit with enough height to read in a groove. */
function makeGritGeometry(): THREE.BufferGeometry {
  const geo = new THREE.TetrahedronGeometry(0.5, 0);
  geo.scale(1.05, 0.62, 0.8);
  const pos = geo.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = hash2((x * 53) | 0, (z * 37) | 0);
    pos.setXYZ(i, x * (0.7 + k * 0.42), y * (0.62 + k * 0.4), z * (0.66 + (1 - k) * 0.4));
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
    if (b.rx && b.rz) {
      const rot = b.rotY ?? 0;
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const lx = dx * c + dz * s;
      const lz = -dx * s + dz * c;
      if ((lx * lx) / (b.rx * b.rx) + (lz * lz) / (b.rz * b.rz) < 1.06) return true;
    } else if (dx * dx + dz * dz < b.r * b.r * 1.35) {
      return true;
    }
  }
  return false;
}

function hash2(x: number, y: number): number {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
