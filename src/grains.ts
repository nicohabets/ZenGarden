import * as THREE from "three";
import { chooseGrainQuality } from "./device";
import { GARDEN } from "./types";

export interface HeightSample {
  (x: number, z: number): number;
}

/**
 * Individual grit on the court. A height field still stores mass; these
 * instanced shards are the sand you actually see — irregular grains that
 * slide out of a tine path and pile on the banks.
 */
export class GrainBed {
  readonly group = new THREE.Group();

  private readonly bed: THREE.InstancedMesh;
  private readonly near: THREE.InstancedMesh;
  private readonly dummy = new THREE.Object3D();
  private readonly sample: HeightSample;

  private readonly bedX: Float32Array;
  private readonly bedZ: Float32Array;
  private readonly bedRx: Float32Array;
  private readonly bedRy: Float32Array;
  private readonly bedRz: Float32Array;
  private readonly bedSx: Float32Array;
  private readonly bedSy: Float32Array;
  private readonly bedSz: Float32Array;
  private readonly bedCount: number;

  private readonly nearX: Float32Array;
  private readonly nearZ: Float32Array;
  private readonly nearRx: Float32Array;
  private readonly nearRy: Float32Array;
  private readonly nearRz: Float32Array;
  private readonly nearSx: Float32Array;
  private readonly nearSy: Float32Array;
  private readonly nearSz: Float32Array;
  private readonly nearLayer: Uint8Array;
  private readonly maxNear: number;
  private nearUsed = 0;

  private lookX = 0;
  private lookZ = 0;
  private lookZoom = -1;
  private readonly nearMinSpacing: number;
  private readonly quality;
  private blockers: Array<{ x: number; z: number; r: number }> = [];

  constructor(sample: HeightSample, software: boolean) {
    this.sample = sample;
    this.quality = chooseGrainQuality(software);
    this.nearMinSpacing = this.quality.nearMinSpacing;
    this.maxNear = this.quality.maxNear;

    const homes = layoutBed(this.quality.bedSpacing, this.quality.maxBed);
    this.bedCount = homes.count;
    this.bedX = homes.x;
    this.bedZ = homes.z;
    this.bedRx = homes.rx;
    this.bedRy = homes.ry;
    this.bedRz = homes.rz;
    this.bedSx = homes.sx;
    this.bedSy = homes.sy;
    this.bedSz = homes.sz;

    this.nearX = new Float32Array(this.maxNear);
    this.nearZ = new Float32Array(this.maxNear);
    this.nearRx = new Float32Array(this.maxNear);
    this.nearRy = new Float32Array(this.maxNear);
    this.nearRz = new Float32Array(this.maxNear);
    this.nearSx = new Float32Array(this.maxNear);
    this.nearSy = new Float32Array(this.maxNear);
    this.nearSz = new Float32Array(this.maxNear);
    this.nearLayer = new Uint8Array(this.maxNear);

    const geo = createGrainGeometry();
    const mat = createGrainMaterial();
    this.bed = makeInstanced(geo, mat, this.bedCount);
    this.near = makeInstanced(geo.clone(), mat.clone(), this.maxNear);
    this.group.add(this.bed);
    this.group.add(this.near);
    this.group.userData.kind = "sand";
    this.paintColors(this.bed, this.bedCount, 17);
    this.paintColors(this.near, this.maxNear, 91);
  }

  getCount(): number {
    return this.bedCount + this.nearUsed;
  }

  setBlockers(blockers: Array<{ x: number; z: number; r: number }>): void {
    this.blockers = blockers;
  }

  rebuild(): void {
    this.placeAll(this.bed, this.bedCount, this.bedX, this.bedZ, this.bedRx, this.bedRy, this.bedRz, this.bedSx, this.bedSy, this.bedSz, null);
    this.lookZoom = -1;
  }

  syncRegion(bounds: { x0: number; z0: number; x1: number; z1: number } | "all" | null): void {
    if (!bounds) return;
    if (bounds === "all") {
      this.rebuild();
      this.placeNear();
      return;
    }
    const pad = 0.12;
    const x0 = bounds.x0 - pad;
    const z0 = bounds.z0 - pad;
    const x1 = bounds.x1 + pad;
    const z1 = bounds.z1 + pad;
    this.placeAll(this.bed, this.bedCount, this.bedX, this.bedZ, this.bedRx, this.bedRy, this.bedRz, this.bedSx, this.bedSy, this.bedSz, { x0, z0, x1, z1 });
    this.placeNear();
  }

  followLook(tx: number, tz: number, zoom: number, elevation = 0.4, aspect = 1.6, azimuth = 0.7): boolean {
    const moved = Math.hypot(tx - this.lookX, tz - this.lookZ);
    const zoomed = Math.abs(zoom - this.lookZoom) / Math.max(0.2, this.lookZoom);
    const spacing = this.nearSpacing(zoom);
    if (this.lookZoom > 0 && moved < spacing * 2.2 && zoomed < 0.08) return false;
    this.lookX = tx;
    this.lookZ = tz;
    this.lookZoom = zoom;
    this.layoutNear(tx, tz, zoom, elevation, aspect, azimuth);
    this.placeNear();
    return true;
  }

  private blocked(x: number, z: number): boolean {
    for (const b of this.blockers) {
      if ((x - b.x) * (x - b.x) + (z - b.z) * (z - b.z) < b.r * b.r) return true;
    }
    return false;
  }

  private nearSpacing(zoom: number): number {
    return THREE.MathUtils.clamp(zoom * 0.01, this.nearMinSpacing, 0.016);
  }

  private layoutNear(tx: number, tz: number, zoom: number, elevation = 0.4, aspect = 1.6, azimuth = 0.7): void {
    const stretch = 1 / Math.max(0.22, Math.sin(elevation));
    const halfAlong = THREE.MathUtils.clamp(zoom * 0.62 * stretch * 1.12, 0.55, 2.4);
    const halfAcross = THREE.MathUtils.clamp(zoom * 0.58 * Math.max(1.1, aspect) * 1.12, 0.42, 1.8);
    const area = halfAlong * 2 * halfAcross * 2;
    const spacing = THREE.MathUtils.clamp(Math.sqrt(area / (this.maxNear * 0.8)), this.nearMinSpacing, 0.02);
    const rightX = Math.cos(azimuth);
    const rightZ = -Math.sin(azimuth);
    const fwdX = -Math.sin(azimuth);
    const fwdZ = -Math.cos(azimuth);
    const cols = Math.max(8, Math.ceil((halfAcross * 2) / spacing));
    const rows = Math.max(8, Math.ceil((halfAlong * 2) / (spacing * 0.86)));
    let n = 0;
    const max = this.maxNear;
    const layer0Budget = Math.floor(max * 0.74);
    for (let j = 0; j < rows && n < layer0Budget; j++) {
      const hex = (j & 1) * 0.5;
      for (let i = 0; i < cols && n < layer0Budget; i++) {
        const jx = hash01(i * 19 + 3, j * 29 + 11) - 0.5;
        const jz = hash01(i * 41 + 7, j * 17 + 5) - 0.5;
        const u = (i + hex - cols * 0.5 + jx * 0.9) * spacing;
        const v = (j - rows * 0.5 + jz * 0.9) * spacing * 0.86;
        const x = tx + u * rightX + v * fwdX;
        const z = tz + u * rightZ + v * fwdZ;
        if (Math.abs(x) > GARDEN.width * 0.5 - 0.04 || Math.abs(z) > GARDEN.depth * 0.5 - 0.04) continue;
        const fat = hash01(i + 3, j + 9) > 0.93 ? 1.25 : 0.58;
        writePose(this.nearX, this.nearZ, this.nearRx, this.nearRy, this.nearRz, this.nearSx, this.nearSy, this.nearSz, n, x, z, i, j, fat);
        this.nearLayer[n] = 0;
        n += 1;
      }
    }
    const layer0 = n;
    const stackBudget = Math.min(max, n + ((n * 0.62) | 0));
    for (let k = 0; k < layer0 && n < stackBudget; k++) {
      if (hash01((k * 13 + 8) | 0, 904) < 0.22) continue;
      this.nearX[n] = this.nearX[k] + (hash01(k, 221) - 0.5) * spacing * 0.45;
      this.nearZ[n] = this.nearZ[k] + (hash01(k, 337) - 0.5) * spacing * 0.45;
      this.nearRx[n] = this.nearRx[k] + 0.4;
      this.nearRy[n] = this.nearRy[k] + 1.1;
      this.nearRz[n] = this.nearRz[k] - 0.3;
      this.nearSx[n] = this.nearSx[k] * 0.86;
      this.nearSy[n] = this.nearSy[k] * 0.8;
      this.nearSz[n] = this.nearSz[k] * 0.9;
      this.nearLayer[n] = 1;
      n += 1;
    }
    this.nearUsed = n;
    for (let i = n; i < max; i++) {
      this.nearSx[i] = 0;
      this.nearSy[i] = 0;
      this.nearSz[i] = 0;
    }
  }

  private placeNear(): void {
    this.placeAll(this.near, this.maxNear, this.nearX, this.nearZ, this.nearRx, this.nearRy, this.nearRz, this.nearSx, this.nearSy, this.nearSz, null, this.nearLayer, this.nearUsed);
  }

  private placeAll(
    mesh: THREE.InstancedMesh,
    count: number,
    xs: Float32Array,
    zs: Float32Array,
    rx: Float32Array,
    ry: Float32Array,
    rz: Float32Array,
    sx: Float32Array,
    sy: Float32Array,
    sz: Float32Array,
    clip: { x0: number; z0: number; x1: number; z1: number } | null,
    layer: Uint8Array | null = null,
    liveCount = count,
  ): void {
    const dummy = this.dummy;
    const sample = this.sample;
    const e = 0.028;
    let wrote = false;
    for (let i = 0; i < count; i++) {
      const x0 = xs[i];
      const z0 = zs[i];
      if (clip && (x0 < clip.x0 || x0 > clip.x1 || z0 < clip.z0 || z0 > clip.z1)) continue;
      wrote = true;
      if (i >= liveCount || sx[i] <= 1e-5) {
        dummy.position.set(0, -2, 0);
        dummy.scale.set(0.001, 0.001, 0.001);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      if (this.blocked(x0, z0)) {
        dummy.position.set(x0, -2, z0);
        dummy.scale.set(0.001, 0.001, 0.001);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      const posed = pushToBank(sample, x0, z0, e);
      const stack = layer ? layer[i] : 0;
      if (stack === 1 && posed.h < 0.01) {
        dummy.position.set(posed.x, -2, posed.z);
        dummy.scale.set(0.001, 0.001, 0.001);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      if (posed.hide) {
        dummy.position.set(posed.x, -2, posed.z);
        dummy.scale.set(0.001, 0.001, 0.001);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      const pile = Math.max(0, posed.h);
      const furrow = posed.h < -0.01 ? 0.48 : 1;
      const yJit = (hash01(i, 77) - 0.32) * 0.012;
      const lift = sy[i] * 0.62 * furrow + (stack === 1 ? 0.01 + pile * 0.55 : 0) + pile * 0.85 + yJit;
      dummy.position.set(posed.x, GARDEN.sandY + posed.h + lift, posed.z);
      dummy.rotation.set(rx[i] + posed.tiltX, ry[i], rz[i] + posed.tiltZ);
      dummy.scale.set(sx[i] * (1 + pile * 1.6) * furrow, sy[i] * (1 + pile * 2.4) * furrow, sz[i] * (1 + pile * 1.6) * furrow);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    if (wrote) mesh.instanceMatrix.needsUpdate = true;
  }

  private paintColors(mesh: THREE.InstancedMesh, count: number, salt: number): void {
    const tones = [
      [0.97, 0.94, 0.88],
      [0.93, 0.9, 0.84],
      [0.89, 0.86, 0.8],
      [0.95, 0.91, 0.85],
      [0.82, 0.78, 0.72],
      [0.91, 0.88, 0.81],
      [0.76, 0.72, 0.66],
      [0.98, 0.96, 0.91],
      [0.88, 0.84, 0.76],
      [0.8, 0.77, 0.71],
    ];
    for (let i = 0; i < count; i++) {
      const t = tones[(Math.imul(i + salt, 1103515245) >>> 0) % tones.length];
      const j = hash01(i + salt, 44);
      mesh.setColorAt(i, new THREE.Color(t[0] - j * 0.04, t[1] - j * 0.035, t[2] - j * 0.03));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

function pushToBank(sample: HeightSample, x: number, z: number, e: number): {
  x: number;
  z: number;
  h: number;
  hide: boolean;
  tiltX: number;
  tiltZ: number;
} {
  const h = sample(x, z);
  const hL = sample(x - e, z);
  const hR = sample(x + e, z);
  const hD = sample(x, z - e);
  const hU = sample(x, z + e);
  const avg = (hL + hR + hD + hU) * 0.25;
  const gx = hR - hL;
  const gz = hU - hD;
  const gLen = Math.hypot(gx, gz);
  let px = x;
  let pz = z;
  if (h < avg - 0.0025 && gLen > 1e-6) {
    const push = Math.min(0.078, (avg - h) * 1.55);
    px += (gx / gLen) * push;
    pz += (gz / gLen) * push;
  }
  const hh = sample(px, pz);
  const hide = hh < -0.04 && h < avg - 0.014;
  return {
    x: px,
    z: pz,
    h: hh,
    hide,
    tiltX: THREE.MathUtils.clamp(-gz * 4.5, -0.55, 0.55),
    tiltZ: THREE.MathUtils.clamp(gx * 4.5, -0.55, 0.55),
  };
}

function layoutBed(spacing: number, maxBed: number): {
  count: number;
  x: Float32Array;
  z: Float32Array;
  rx: Float32Array;
  ry: Float32Array;
  rz: Float32Array;
  sx: Float32Array;
  sy: Float32Array;
  sz: Float32Array;
} {
  const x0 = -GARDEN.width * 0.5 + 0.05;
  const z0 = -GARDEN.depth * 0.5 + 0.05;
  const cols = Math.ceil(GARDEN.width / spacing);
  const rows = Math.ceil(GARDEN.depth / (spacing * 0.86));
  const count = Math.min(maxBed, cols * rows);
  const x = new Float32Array(count);
  const z = new Float32Array(count);
  const rx = new Float32Array(count);
  const ry = new Float32Array(count);
  const rz = new Float32Array(count);
  const sx = new Float32Array(count);
  const sy = new Float32Array(count);
  const sz = new Float32Array(count);
  let n = 0;
  for (let j = 0; j < rows && n < count; j++) {
    const hex = (j & 1) * 0.5;
    for (let i = 0; i < cols && n < count; i++) {
      const jx = hash01(i * 7 + 2, j * 11 + 4) - 0.5;
      const jz = hash01(i * 13 + 5, j * 3 + 8) - 0.5;
      const gx = x0 + (i + hex + jx * 0.92) * spacing;
      const gz = z0 + (j + jz * 0.92) * spacing * 0.86;
      if (Math.abs(gx) > GARDEN.width * 0.5 - 0.03 || Math.abs(gz) > GARDEN.depth * 0.5 - 0.03) continue;
      writePose(x, z, rx, ry, rz, sx, sy, sz, n, gx, gz, i, j, 1);
      n += 1;
    }
  }
  return { count: n, x, z, rx, ry, rz, sx, sy, sz };
}

function writePose(
  x: Float32Array,
  z: Float32Array,
  rx: Float32Array,
  ry: Float32Array,
  rz: Float32Array,
  sx: Float32Array,
  sy: Float32Array,
  sz: Float32Array,
  i: number,
  gx: number,
  gz: number,
  col: number,
  row: number,
  size: number,
): void {
  x[i] = gx;
  z[i] = gz;
  rx[i] = hash01(col, row + 21) * Math.PI;
  ry[i] = hash01(col + 9, row) * Math.PI * 2;
  rz[i] = hash01(col + 3, row + 7) * Math.PI;
  const s = (0.0036 + hash01(col + 15, row + 4) * 0.0058) * size;
  sx[i] = s * (0.7 + hash01(col, row + 33) * 0.7);
  sy[i] = s * (0.52 + hash01(col + 18, row) * 0.62);
  sz[i] = s * (0.66 + hash01(col + 4, row + 12) * 0.68);
}

function makeInstanced(geo: THREE.BufferGeometry, mat: THREE.Material, count: number): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.raycast = () => undefined;
  mesh.userData.kind = "sand";
  return mesh;
}

function createGrainGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const h = hash01(((x + 2) * 17) | 0, ((z + 3) * 13 + i) | 0);
    pos.setXYZ(i, x + (h - 0.5) * 0.22, y + (hash01(i, 8) - 0.5) * 0.18, z + (hash01(i, 19) - 0.5) * 0.2);
  }
  geo.computeVertexNormals();
  return geo;
}

function createGrainMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0.015,
    emissive: 0x3d382e,
    emissiveIntensity: 0.2,
    vertexColors: false,
    flatShading: false,
    envMapIntensity: 0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         float grainHash(vec3 p) {
           return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
         }
        `,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         {
           float iid = float(gl_InstanceID);
           vec3 n = objectNormal;
           float k = grainHash(position * 4.2 + vec3(iid * 0.017, iid * 0.009, iid * 0.013));
           transformed += n * (k - 0.5) * 0.2;
         }
        `,
      );
  };
  mat.customProgramCacheKey = () => "sand-grain-shard-v2";
  return mat;
}

function hash01(x: number, y: number): number {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
