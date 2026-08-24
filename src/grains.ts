import * as THREE from "three";
import type { CameraRig } from "./camera";
import { isMobileGarden, wantHighQuality } from "./device";
import type { SandField } from "./sand";
import { GARDEN, type Blocker } from "./types";

/** Visible grit sitting on the mass field. Budget keeps a 60fps mobile path. */
export function grainBudget(): number {
  if (wantHighQuality()) return 220_000;
  if (isMobileGarden()) return 64_000;
  return 140_000;
}

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

/**
 * Packed millimetre grit as instanced nuggets. Point sprites vanish to
 * speckle under SwiftShader; these are real meshes that ride the mass field.
 */
export class GrainCloud {
  readonly mesh: THREE.InstancedMesh;
  private readonly maxCount: number;
  private count = 0;
  private lastKey = "";
  private lastHeightAt = 0;
  private readonly xs: Float32Array;
  private readonly zs: Float32Array;
  private readonly seeds: Float32Array;
  private readonly layers: Float32Array;

  constructor() {
    this.maxCount = grainBudget();
    this.xs = new Float32Array(this.maxCount);
    this.zs = new Float32Array(this.maxCount);
    this.seeds = new Float32Array(this.maxCount);
    this.layers = new Float32Array(this.maxCount);

    const geo = makeGritGeometry();
    const mat = new THREE.MeshStandardMaterial({
      roughness: 1,
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
    const surfaceBudget = Math.floor(this.maxCount * 0.82);
    const spacing = Math.max(0.0014, Math.sqrt((spanX * spanZ) / Math.max(8, surfaceBudget)));
    const worldSize = spacing * 1.78;

    const hex = spacing * 0.86602540378;
    let n = 0;
    let row = 0;
    for (let z = z0; z <= z1 && n < surfaceBudget; z += hex, row++) {
      const xShift = row & 1 ? spacing * 0.5 : 0;
      for (let x = x0 + xShift; x <= x1 && n < surfaceBudget; x += spacing) {
        const col = ((x - x0) / spacing) | 0;
        const jx = hash2(row * 13 + 3, col) - 0.5;
        const jz = hash2(row * 29 + 7, col + 11) - 0.5;
        const gx = x + jx * spacing * 0.32;
        const gz = z + jz * spacing * 0.32;
        if (gx < x0 || gx > x1 || gz < z0 || gz > z1) continue;
        if (blocked(gx, gz, blockers)) continue;
        this.xs[n] = gx;
        this.zs[n] = gz;
        this.seeds[n] = hash2(row * 17 + 4, n * 3 + 9);
        this.layers[n] = 0;
        n += 1;
      }
    }

    const surface = n;
    const pileBudget = Math.min(this.maxCount - n, Math.floor(this.maxCount * 0.18));
    const step = Math.max(1, Math.floor(surface / Math.max(1, pileBudget)));
    for (let i = 0; i < surface && n < this.maxCount && n - surface < pileBudget; i += step) {
      const h = sand.sampleHeight(this.xs[i], this.zs[i]);
      if (h < 0.006) continue;
      this.xs[n] = this.xs[i] + (this.seeds[i] - 0.5) * spacing * 0.26;
      this.zs[n] = this.zs[i] + (hash2(i + 5, 41) - 0.5) * spacing * 0.26;
      this.seeds[n] = hash2(i + 19, 23);
      this.layers[n] = 1;
      n += 1;
    }

    this.count = n;
    this.mesh.count = n;
    this.writeInstances(sand, worldSize);
  }

  private lift(sand: SandField, cam: CameraRig): void {
    const bounds = slantBounds(cam);
    const spanX = Math.max(0.1, bounds.x1 - bounds.x0);
    const spanZ = Math.max(0.1, bounds.z1 - bounds.z0);
    const spacing = Math.max(0.0014, Math.sqrt((spanX * spanZ) / Math.max(8, Math.floor(this.maxCount * 0.82))));
    this.writeInstances(sand, spacing * 1.78);
  }

  private writeInstances(sand: SandField, worldSize: number): void {
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const seed = this.seeds[i];
      const h = sand.sampleHeight(this.xs[i], this.zs[i]);
      const pile = Math.max(0, h);
      const y = GARDEN.sandY + 0.0018 + pile * 1.55 + this.layers[i] * (0.004 + pile * 0.1) + (seed - 0.5) * 0.0012;
      const s = worldSize * (0.68 + seed * 0.38 + pile * 1.6);
      _dummy.position.set(this.xs[i], y, this.zs[i]);
      _dummy.rotation.set(seed * 5.1, seed * 6.8, hash2(i + 3, 17) * 6.2);
      _dummy.scale.set(s * (0.88 + seed * 0.24), s * (0.48 + seed * 0.2), s * (0.82 + hash2(i, 9) * 0.28));
      _dummy.updateMatrix();
      this.mesh.setMatrixAt(i, _dummy.matrix);
      const crest = Math.min(0.1, pile * 1.6);
      _color.setRGB(0.84 + seed * 0.08 + crest, 0.80 + seed * 0.06 + crest * 0.7, 0.72 + seed * 0.05 + crest * 0.45);
      this.mesh.setColorAt(i, _color);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

function makeGritGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(0.5, 4, 3);
  geo.scale(1.05, 0.22, 0.8);
  const pos = geo.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = hash2((x * 21) | 0, (z * 15) | 0);
    pos.setXYZ(i, x * (0.88 + k * 0.2), y * (0.8 + k * 0.28), z * (0.86 + (1 - k) * 0.2));
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
    if (dx * dx + dz * dz < b.r * b.r * 0.84) return true;
  }
  return false;
}

function hash2(x: number, y: number): number {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
