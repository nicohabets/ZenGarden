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

/** Bank growth in metres so a leftover pile still sits on the bed. */
const LAYER_H = 0.0022;

/**
 * Small rounded grit on the grit-colored bed. Troughs stay a thinner
 * packed bed. Extra piles sit only on rake ridges, not island dirt.
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
      this.layout(cam, sand, blockers, viewH);
    }
  }

  private layout(cam: CameraRig, sand: SandField, blockers: Blocker[], viewH: number): void {
    const court = courtBounds();
    const close = cam.zoom < 1.2;
    const hud = cam.zoom >= 2.3;
    // Always plant the view. Full-court at HUD made a noise sheet of
    // pin-head grains; close-up already used the frustum.
    const bounds = slantBounds(cam);
    const x0 = Math.max(court.x0, bounds.x0);
    const x1 = Math.min(court.x1, bounds.x1);
    const z0 = Math.max(court.z0, bounds.z0);
    const z1 = Math.min(court.z1, bounds.z1);
    const spanX = Math.max(0.1, x1 - x0);
    const spanZ = Math.max(0.1, z1 - z0);
    const hq = wantHighQuality();
    const carpetCap = Math.floor(this.maxCount * (hud ? 0.86 : 0.9));
    const spacing = Math.max(0.00105, Math.sqrt((spanX * spanZ) / Math.max(8, carpetCap * (hud ? 0.55 : 0.82))));
    const px = Math.max(1, viewH);
    const targetPx = close ? 7 : hud ? 18 : 11;
    const screenWorld = (targetPx * cam.zoom) / px;
    const pack = close ? 1.78 : hud ? 1.22 : 1.5;
    const worldSize = Math.max(spacing * pack, screenWorld);

    let n = 0;
    n = this.plantCarpet(n, x0, z0, x1, z1, spacing, sand, blockers, Math.floor(this.maxCount * (hud ? 0.62 : 0.68)), 0, 0.2);
    n = this.plantCarpet(
      n,
      x0 + spacing * 0.5,
      z0 + spacing * 0.29,
      x1,
      z1,
      spacing,
      sand,
      blockers,
      carpetCap,
      0,
      0.16,
    );
    if (!hud) {
      n = this.plantCarpet(
        n,
        x0 + spacing * 0.25,
        z0 + spacing * 0.58,
        x1,
        z1,
        spacing * 0.92,
        sand,
        blockers,
        Math.floor(this.maxCount * 0.95),
        0,
        0.18,
      );
    }

    const pathStep = hq ? Math.max(spacing * 0.45, 0.0024) : Math.max(spacing * 0.85, 0.014);
    const troughCap = Math.floor(this.maxCount * 0.985);
    const troughHalf = Math.max(0.03, spacing * 5);
    const troughStep = Math.max(spacing * 0.5, hq ? 0.0022 : spacing * 0.62);
    sand.forEachTrough(x0, z0, x1, z1, pathStep, (x, z, tx, tz) => {
      if (n >= troughCap) return;
      const across = Math.hypot(tx, tz) || 1;
      const nx = -tz / across;
      const nz = tx / across;
      for (let k = -troughHalf; k <= troughHalf && n < troughCap; k += troughStep) {
        const gx = x + nx * k + (hash2((x * 67 + k * 40) | 0, 3) - 0.5) * spacing * 0.2;
        const gz = z + nz * k + (hash2(5, (z * 83 + k * 40) | 0) - 0.5) * spacing * 0.2;
        if (blocked(gx, gz, blockers)) continue;
        n = this.pushGrain(n, gx, gz, sand.sampleHeight(gx, gz), hash2((gx * 90) | 0, (gz * 90) | 0), 0);
      }
    });

    this.count = n;
    this.mesh.count = n;
    this.writeInstances(worldSize, blockers);
  }

  private plantCarpet(
    n: number,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    spacing: number,
    sand: SandField,
    blockers: Blocker[],
    cap: number,
    layer: number,
    jitter: number,
  ): number {
    let row = 0;
    for (let z = z0; z <= z1 && n < cap; z += spacing, row++) {
      const rowShift = (row % 2) * spacing * 0.5;
      for (let x = x0 + rowShift; x <= x1 && n < cap; x += spacing) {
        const col = ((x - x0) / spacing) | 0;
        const hx = hash2(row * 19 + 3, col * 11 + 5);
        const hz = hash2(row * 41 + 7, col * 23 + 2);
        const gx = x + (hx - 0.5) * spacing * jitter;
        const gz = z + (hz - 0.5) * spacing * jitter;
        if (gx < x0 - spacing || gx > x1 + spacing || gz < z0 - spacing || gz > z1 + spacing) continue;
        if (blocked(gx, gz, blockers)) continue;
        n = this.pushGrain(n, gx, gz, sand.sampleHeight(gx, gz), hx, layer);
      }
    }
    return n;
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

  private writeInstances(worldSize: number, blockers: Blocker[]): void {
    const n = this.count;
    const hide = worldSize * 0.4;
    for (let i = 0; i < n; i++) {
      const seed = this.seeds[i];
      const h = this.hs[i];
      const layer = this.layers[i];
      // Hard mask: grain bodies never sit on moss.
      if (blockedPadded(this.xs[i], this.zs[i], blockers, hide)) {
        _dummy.position.set(0, -4, 0);
        _dummy.scale.setScalar(0);
        _dummy.updateMatrix();
        this.mesh.setMatrixAt(i, _dummy.matrix);
        _color.setRGB(0.6, 0.56, 0.46);
        this.mesh.setColorAt(i, _color);
        continue;
      }
      const floor = h * SAND_HEIGHT_GAIN;
      const lift = Math.max(floor, -0.008);
      const y = GARDEN.sandY + lift + worldSize * 0.36 + layer * LAYER_H;
      const s = worldSize * (0.88 + seed * 0.18);
      _dummy.position.set(this.xs[i], y, this.zs[i]);
      _dummy.rotation.set(seed * 6.2, seed * 8.1, hash2(i + 3, 17) * 6.8);
      _dummy.scale.set(s * (0.9 + seed * 0.16), s * (0.72 + seed * 0.18), s * (0.88 + hash2(i, 9) * 0.16));
      _dummy.updateMatrix();
      this.mesh.setMatrixAt(i, _dummy.matrix);
      const trough = h < -0.004 ? -0.025 : 0;
      const t = seed;
      _color.setRGB(0.56 + t * 0.28 + trough, 0.52 + t * 0.22 + trough, 0.42 + t * 0.18 + trough);
      this.mesh.setColorAt(i, _color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** Small rounded, irregular pebble — not a crystal and not a paper flake. */
function makeGritGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.48, 5, 4);
  geo.scale(1.08, 0.74, 1.02);
  const pos = geo.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = hash2((x * 53) | 0, (z * 37) | 0);
    pos.setXYZ(i, x * (0.88 + k * 0.18), y * (0.84 + k * 0.2), z * (0.86 + (1 - k) * 0.18));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function courtBounds(): { x0: number; z0: number; x1: number; z1: number } {
  return {
    x0: -GARDEN.width / 2 + 0.03,
    z0: -GARDEN.depth / 2 + 0.03,
    x1: GARDEN.width / 2 - 0.03,
    z1: GARDEN.depth / 2 - 0.03,
  };
}

function slantBounds(cam: CameraRig): { x0: number; z0: number; x1: number; z1: number } {
  // Intersect the ortho frustum with the court so grazing close-ups stay packed.
  cam.camera.updateMatrixWorld();
  const samples: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  const near = new THREE.Vector3();
  const far = new THREE.Vector3();
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  let hits = 0;
  for (const [nx, ny] of samples) {
    near.set(nx, ny, -1).unproject(cam.camera);
    far.set(nx, ny, 1).unproject(cam.camera);
    const dy = far.y - near.y;
    if (Math.abs(dy) < 1e-6) continue;
    const t = (GARDEN.sandY - near.y) / dy;
    if (t < -0.05 || t > 1.05) continue;
    const x = near.x + (far.x - near.x) * t;
    const z = near.z + (far.z - near.z) * t;
    x0 = Math.min(x0, x);
    z0 = Math.min(z0, z);
    x1 = Math.max(x1, x);
    z1 = Math.max(z1, z);
    hits += 1;
  }
  if (hits < 2) {
    const sinE = Math.max(0.12, Math.sin(cam.elevation));
    const halfAlong = cam.zoom / sinE;
    const halfAcross = cam.zoom * cam.aspect;
    return {
      x0: cam.target.x - halfAcross,
      z0: cam.target.z - halfAlong,
      x1: cam.target.x + halfAcross,
      z1: cam.target.z + halfAlong,
    };
  }
  const pad = Math.max(0.22, cam.zoom * 0.45);
  return { x0: x0 - pad, z0: z0 - pad, x1: x1 + pad, z1: z1 + pad };
}

function blocked(x: number, z: number, blockers: Blocker[]): boolean {
  return blockedPadded(x, z, blockers, 0);
}

function blockedPadded(x: number, z: number, blockers: Blocker[], pad: number): boolean {
  for (const b of blockers) {
    const dx = x - b.x;
    const dz = z - b.z;
    if (b.rx && b.rz) {
      const rot = b.rotY ?? 0;
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const lx = dx * c + dz * s;
      const lz = -dx * s + dz * c;
      const rx = b.rx + pad;
      const rz = b.rz + pad;
      if ((lx * lx) / (rx * rx) + (lz * lz) / (rz * rz) < 1) return true;
    } else if (dx * dx + dz * dz < (b.r + pad) * (b.r + pad)) {
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
