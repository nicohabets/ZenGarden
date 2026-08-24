import * as THREE from "three";
import { chooseDisplayGrid, chooseSimGrid } from "./device";
import { mulberry32 } from "./rng";
import { GARDEN, type Blocker, type SandTone } from "./types";

/** Packed height+rake-direction payload for localStorage. */
export const HEIGHT_PREFIX = "hf1:";
export const HEIGHT_RLE_PREFIX = "hf1r:";

const H_MIN = -0.086;
const H_MAX = 0.086;
const H_RANGE = H_MAX - H_MIN;
const REPOSE = Math.tan((30 * Math.PI) / 180);
const TINES = 5;
const TINE_GAP = 0.114;
const TROUGH_SIGMA = 0.036;
const RIDGE_OFF = 0.056;
const RIDGE_SIGMA = 0.03;
const RAKE_DEPTH = 0.05;

/**
 * Gentle bed only. Steep displacement turned the close-up into a sawtooth
 * wall; groove relief is piled grit, not the height-field mesh.
 */
export const SAND_HEIGHT_GAIN = 0.48;
export const SAND_DISP_SCALE = H_RANGE * SAND_HEIGHT_GAIN;
export const SAND_DISP_BIAS = H_MIN * SAND_HEIGHT_GAIN;
/** Legacy sample space so groove APIs stay in the old 1024-wide units. */
const SAMPLE_SCALE = 2;
const LEGACY_W = 1024;

export interface Occupant {
  x: number;
  z: number;
  r: number;
  pile?: number;
  sink?: number;
}

interface Rect {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
}

interface RakeMark {
  kind: "seg" | "arc";
  ax: number;
  az: number;
  bx: number;
  bz: number;
  cx: number;
  cz: number;
  r: number;
  a0: number;
  a1: number;
  depth: number;
  multi: boolean;
}

/**
 * Court mass: a CPU height field with conservation rake and angle-of-repose
 * slump. The mesh is the grit-colored bed; visible sand is that bed plus
 * a packed cloud of small rounded grains.
 */
export class SandField {
  readonly mesh: THREE.Mesh;
  readonly texture: THREE.DataTexture;
  readonly simW: number;
  readonly simH: number;
  readonly height: Float32Array;
  readonly dirX: Float32Array;
  readonly dirZ: Float32Array;

  private readonly field: Uint8Array<ArrayBuffer>;
  private readonly dispW: number;
  private readonly dispH: number;
  private readonly scratch: Float32Array;
  private dirty: Rect | null = null;
  private slumpRect: Rect | null = null;
  private slumpLeft = 0;
  private slumpRow = 0;
  private packNeeded = false;
  private occupantsDirty = false;
  private readonly marks: RakeMark[] = [];
  private readonly cellX: number;
  private readonly cellZ: number;
  private readonly cellMin: number;

  constructor() {
    const sim = chooseSimGrid();
    this.simW = sim.w;
    this.simH = sim.h;
    const n = sim.w * sim.h;
    this.height = new Float32Array(n);
    this.dirX = new Float32Array(n);
    this.dirZ = new Float32Array(n);
    this.scratch = new Float32Array(n);
    const display = chooseDisplayGrid(sim);
    this.dispW = display.w;
    this.dispH = display.h;
    this.field = new Uint8Array(new ArrayBuffer(display.w * display.h * 4));
    this.cellX = GARDEN.width / (sim.w - 1);
    this.cellZ = GARDEN.depth / (sim.h - 1);
    this.cellMin = Math.min(this.cellX, this.cellZ);

    this.texture = new THREE.DataTexture(this.field, display.w, display.h, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.texture.flipY = true;

    const geo = new THREE.PlaneGeometry(GARDEN.width, GARDEN.depth, display.w - 1, display.h - 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({
      color: 0xb7ab97,
      displacementMap: this.texture,
      displacementScale: SAND_DISP_SCALE,
      displacementBias: SAND_DISP_BIAS,
    });
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = 2;
    mat.polygonOffsetUnits = 2;

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = GARDEN.sandY;
    this.mesh.receiveShadow = false;
    this.mesh.castShadow = false;
    this.mesh.userData.kind = "sand";

    this.markAllDirty();
  }

  paintBase(seed: number): void {
    const rng = mulberry32(seed);
    const n = this.height.length;
    for (let i = 0; i < n; i++) {
      const j = (i / this.simW) | 0;
      const x = i % this.simW;
      const und =
        (rng() - 0.5) * 0.007 +
        0.0024 * Math.sin(x * 0.17 + seed) +
        0.0018 * Math.cos(j * 0.21 + seed * 0.4);
      this.height[i] = und;
      this.dirX[i] = 0;
      this.dirZ[i] = 0;
    }
    this.marks.length = 0;
    this.markAllDirty();
    this.queueSlump(3);
  }

  worldToUv(x: number, z: number): { u: number; v: number } {
    return {
      u: (x / GARDEN.width + 0.5) * LEGACY_W,
      v: (z / GARDEN.depth + 0.5) * (LEGACY_W * (GARDEN.depth / GARDEN.width)),
    };
  }

  sampleHeight(x: number, z: number): number {
    const u = x / GARDEN.width + 0.5;
    const v = z / GARDEN.depth + 0.5;
    return this.sampleBilinear(u * (this.simW - 1), v * (this.simH - 1));
  }

  sampleDir(x: number, z: number): { x: number; z: number } {
    const i = this.worldToI(x);
    const j = this.worldToJ(z);
    return { x: this.dirX[j * this.simW + i], z: this.dirZ[j * this.simW + i] };
  }

  /** Sharp rake profile at grain scale, before slump smooths the mass field. */
  sampleVisual(x: number, z: number): number {
    let mark = 0;
    for (let i = 0; i < this.marks.length; i++) mark += markDelta(this.marks[i], x, z);
    if (Math.abs(mark) < 1e-4) return this.sampleHeight(x, z);
    return mark;
  }

  /** Walk tine crests so grit can pile along the same lines the rake carved. */
  forEachBank(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    step: number,
    fn: (x: number, z: number, alongX: number, alongZ: number, h: number) => void,
  ): void {
    const ds = Math.max(0.016, step);
    for (let i = 0; i < this.marks.length; i++) {
      const m = this.marks[i];
      const offs = ridgeOffsets(m.multi);
      const h = m.depth * 0.62;
      if (m.kind === "seg") {
        const dx = m.bx - m.ax;
        const dz = m.bz - m.az;
        const len = Math.hypot(dx, dz);
        if (len < 0.04) continue;
        const tx = dx / len;
        const tz = dz / len;
        const nx = -tz;
        const nz = tx;
        for (let t = 0; t <= len; t += ds) {
          const px = m.ax + tx * t;
          const pz = m.az + tz * t;
          for (let k = 0; k < offs.length; k++) {
            const x = px + nx * offs[k];
            const z = pz + nz * offs[k];
            if (x < x0 || x > x1 || z < z0 || z > z1) continue;
            fn(x, z, tx, tz, h);
          }
        }
        continue;
      }
      let sweep = m.a1 - m.a0;
      while (sweep > Math.PI * 2) sweep -= Math.PI * 2;
      while (sweep < -Math.PI * 2) sweep += Math.PI * 2;
      const da = ds / Math.max(0.12, m.r);
      const dir = sweep >= 0 ? 1 : -1;
      for (let a = 0; a <= Math.abs(sweep) + 1e-6; a += da) {
        const ang = m.a0 + dir * a;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const tx = -sa;
        const tz = ca;
        for (let k = 0; k < offs.length; k++) {
          const r = m.r + offs[k];
          const x = m.cx + ca * r;
          const z = m.cz + sa * r;
          if (x < x0 || x > x1 || z < z0 || z > z1) continue;
          fn(x, z, tx, tz, h);
        }
      }
    }
  }

  /** Walk tine bottoms so the trough stays packed grit, not a bare slab. */
  forEachTrough(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    step: number,
    fn: (x: number, z: number, alongX: number, alongZ: number, h: number) => void,
  ): void {
    const ds = Math.max(0.012, step);
    for (let i = 0; i < this.marks.length; i++) {
      const m = this.marks[i];
      const offs = troughOffsets(m.multi);
      const h = -m.depth * 0.85;
      if (m.kind === "seg") {
        const dx = m.bx - m.ax;
        const dz = m.bz - m.az;
        const len = Math.hypot(dx, dz);
        if (len < 0.04) continue;
        const tx = dx / len;
        const tz = dz / len;
        const nx = -tz;
        const nz = tx;
        for (let t = 0; t <= len; t += ds) {
          const px = m.ax + tx * t;
          const pz = m.az + tz * t;
          for (let k = 0; k < offs.length; k++) {
            const x = px + nx * offs[k];
            const z = pz + nz * offs[k];
            if (x < x0 || x > x1 || z < z0 || z > z1) continue;
            fn(x, z, tx, tz, h);
          }
        }
        continue;
      }
      let sweep = m.a1 - m.a0;
      while (sweep > Math.PI * 2) sweep -= Math.PI * 2;
      while (sweep < -Math.PI * 2) sweep += Math.PI * 2;
      const da = ds / Math.max(0.12, m.r);
      const dir = sweep >= 0 ? 1 : -1;
      for (let a = 0; a <= Math.abs(sweep) + 1e-6; a += da) {
        const ang = m.a0 + dir * a;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        const tx = -sa;
        const tz = ca;
        for (let k = 0; k < offs.length; k++) {
          const r = m.r + offs[k];
          const x = m.cx + ca * r;
          const z = m.cz + sa * r;
          if (x < x0 || x > x1 || z < z0 || z > z1) continue;
          fn(x, z, tx, tz, h);
        }
      }
    }
  }

  getSandVolume(): number {
    let sum = 0;
    for (let i = 0; i < this.height.length; i++) sum += this.height[i];
    return sum;
  }

  getSandTone(): SandTone {
    let acc = 0;
    let n = 0;
    const step = Math.max(3, (this.simW / 48) | 0);
    for (let j = 2; j < this.simH - 2; j += step) {
      for (let i = 2; i < this.simW - 2; i += step) {
        const h = this.height[j * this.simW + i];
        const shade = 0.74 + ((h - H_MIN) / H_RANGE) * 0.28;
        acc += shade;
        n += 1;
      }
    }
    const k = acc / Math.max(1, n);
    const r = 236 * k;
    const g = 230 * k;
    const b = 218 * k;
    return { r, g, b, luma: r * 0.3 + g * 0.59 + b * 0.11 };
  }

  rake(fromX: number, fromZ: number, toX: number, toZ: number, blockers: Blocker[]): void {
    if (!this.clearOfBlockers(fromX, fromZ, blockers) && !this.clearOfBlockers(toX, toZ, blockers)) {
      return;
    }
    this.carveSegment(fromX, fromZ, toX, toZ, blockers, RAKE_DEPTH, true);
    this.queueSlump(4);
  }

  rakeArc(cx: number, cz: number, radius: number, a0: number, a1: number, blockers: Blocker[]): void {
    const sweep = a1 - a0;
    if (Math.abs(sweep) < 0.008 || radius < 0.12) return;
    this.carveArc(cx, cz, radius, a0, a1, blockers, RAKE_DEPTH, false);
    this.queueSlump(4);
  }

  paintRing(wx: number, wz: number, radiusWorld: number, innerWorld = 0.42, tineGap = 0.165): void {
    for (let r = innerWorld + tineGap; r < radiusWorld; r += tineGap) {
      this.carveArc(wx, wz, r, 0, Math.PI * 2, [], RAKE_DEPTH * 0.92, true);
    }
    this.queueSlump(4);
  }

  paintParallel(seed: number): void {
    const rng = mulberry32(seed ^ 0x51ed);
    const gap = 0.17 + rng() * 0.03;
    const inset = 0.28;
    const z0 = -GARDEN.depth / 2 + inset;
    const z1 = GARDEN.depth / 2 - inset;
    const x0 = -GARDEN.width / 2 + inset;
    const x1 = GARDEN.width / 2 - inset;
    const i0 = this.clampI(this.worldToI(x0));
    const i1 = this.clampI(this.worldToI(x1));
    const j0 = this.clampJ(this.worldToJ(z0 - 0.22));
    const j1 = this.clampJ(this.worldToJ(z1 + 0.22));
    const depth = RAKE_DEPTH * 0.78;
    const grooves: number[] = [];
    for (let z = z0; z <= z1; z += gap) grooves.push(z);
    for (let j = j0; j <= j1; j++) {
      const z = this.jToWorld(j);
      let delta = 0;
      for (const gz of grooves) delta += singleTine(z - gz) * depth;
      if (Math.abs(delta) < 1e-5) continue;
      for (let i = i0; i <= i1; i++) {
        const idx = j * this.simW + i;
        const wobble = 1 + 0.07 * Math.sin(i * 0.37 + z * 4.1);
        const jag = 0.84 + hash2(i * 17, j * 29) * 0.34;
        this.height[idx] += delta * wobble * jag + (hash2(i + 2, j + 8) - 0.5) * 0.0024;
        this.dirX[idx] = 1;
        this.dirZ[idx] = 0;
      }
    }
    this.expandDirty(i0, j0, i1, j1);
    this.queueSlump(4);
    for (const gz of grooves) {
      this.marks.push({
        kind: "seg",
        ax: x0,
        az: gz,
        bx: x1,
        bz: gz,
        cx: 0,
        cz: 0,
        r: 0,
        a0: 0,
        a1: 0,
        depth,
        multi: false,
      });
    }
  }

  embedOccupants(items: Occupant[]): void {
    for (const it of items) {
      this.bankObject(it.x, it.z, it.r, it.pile ?? 0.02, it.sink ?? 0.022);
    }
    this.occupantsDirty = true;
    this.queueSlump(4);
  }

  bankObject(x: number, z: number, radius: number, pile: number, sink: number): void {
    const pad = radius * 1.85;
    const i0 = this.clampI(this.worldToI(x - pad));
    const i1 = this.clampI(this.worldToI(x + pad));
    const j0 = this.clampJ(this.worldToJ(z - pad));
    const j1 = this.clampJ(this.worldToJ(z + pad));
    let removed = 0;
    let depositW = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const wx = this.iToWorld(i);
        const wz = this.jToWorld(j);
        const d = Math.hypot(wx - x, wz - z);
        const idx = j * this.simW + i;
        if (d < radius * 0.72) {
          const w = 1 - d / (radius * 0.72);
          const take = sink * w * w;
          this.height[idx] -= take;
          removed += take;
        } else if (d < radius * 1.7) {
          const t = (d - radius * 0.78) / (radius * 0.92);
          const w = Math.exp(-0.5 * ((t - 0.35) / 0.28) ** 2);
          this.scratch[idx] = w;
          depositW += w;
        } else {
          this.scratch[idx] = 0;
        }
      }
    }
    if (depositW > 1e-6) {
      const gain = (removed * (pile > 0 ? 1 : 0) || removed) / depositW;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const idx = j * this.simW + i;
          const w = this.scratch[idx];
          if (w > 0) this.height[idx] += gain * w;
          this.scratch[idx] = 0;
        }
      }
    }
    this.expandDirty(i0, j0, i1, j1);
  }

  settle(steps = 8): void {
    const rect = this.slumpRect ?? this.dirty ?? this.fullRect();
    this.slumpRegion(rect, steps);
    this.clampRect(rect);
    this.packTexture();
    this.slumpLeft = 0;
    this.occupantsDirty = true;
  }

  queueSlump(steps = 6): void {
    this.slumpLeft = Math.max(this.slumpLeft, steps);
    this.slumpRect = this.dirty ? copyRect(this.dirty) : this.slumpRect;
    this.slumpRow = this.slumpRect?.j0 ?? 1;
  }

  stepSlump(_dt: number): void {
    if (this.slumpLeft <= 0) return;
    const rect = this.slumpRect ?? this.dirty;
    if (!rect) {
      this.slumpLeft = 0;
      return;
    }
    const cells = (rect.i1 - rect.i0 + 1) * (rect.j1 - rect.j0 + 1);
    if (cells <= 720) {
      this.slumpRegion(rect, 1);
      this.clampRect(rect);
      this.slumpLeft -= 1;
    } else {
      const bandH = 8;
      const j0 = this.slumpRow;
      const j1 = Math.min(rect.j1, j0 + bandH - 1);
      this.slumpRegion({ i0: rect.i0, j0, i1: rect.i1, j1 }, 1);
      this.clampRect({ i0: rect.i0, j0, i1: rect.i1, j1 });
      this.slumpRow = j1 + 1;
      if (this.slumpRow > rect.j1) {
        this.slumpRow = rect.j0;
        this.slumpLeft -= 1;
      }
    }
    this.packNeeded = true;
    if (this.slumpLeft <= 0) this.occupantsDirty = true;
  }

  consumeOccupantSettle(): boolean {
    if (!this.occupantsDirty) return false;
    this.occupantsDirty = false;
    return true;
  }

  sampleGrooveDeviation(fromX: number, fromZ: number, toX: number, toZ: number): number {
    const dx = toX - fromX;
    const dz = toZ - fromZ;
    const len = Math.hypot(dx, dz);
    if (len < 0.2) return 0;
    const nx = -dz / len;
    const nz = dx / len;
    const offsets: number[] = [];
    const steps = 28;
    let prev = 0;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = fromX + dx * t;
      const cz = fromZ + dz * t;
      let best = prev;
      let bestH = 99;
      const win = s === 0 ? 0.14 : 0.08;
      for (let o = prev - win; o <= prev + win; o += 0.012) {
        const h = this.sampleHeight(cx + nx * o, cz + nz * o);
        if (h < bestH) {
          bestH = h;
          best = o;
        }
      }
      prev = best;
      offsets.push(best * (LEGACY_W / GARDEN.width) / SAMPLE_SCALE);
    }
    return stddev(offsets);
  }

  sampleArcDeviation(cx: number, cz: number, radius: number, a0 = 0, a1 = Math.PI * 2): number {
    const steps = 36;
    const radii: number[] = [];
    let prev = 0;
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      const px = cx + Math.cos(a) * radius;
      const pz = cz + Math.sin(a) * radius;
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      let best = prev;
      let bestH = 99;
      const win = i === 0 ? 0.12 : 0.08;
      for (let o = prev - win; o <= prev + win; o += 0.01) {
        const h = this.sampleHeight(px + nx * o, pz + nz * o);
        if (h < bestH) {
          bestH = h;
          best = o;
        }
      }
      prev = best;
      radii.push(best * (LEGACY_W / GARDEN.width) / SAMPLE_SCALE);
    }
    return stddev(radii);
  }

  exportDataUrl(): string {
    this.packTexture();
    const raw = new Uint8Array(this.simW * this.simH);
    for (let i = 0; i < raw.length; i++) {
      const t = (this.height[i] - H_MIN) / H_RANGE;
      raw[i] = t <= 0 ? 0 : t >= 1 ? 255 : (t * 255 + 0.5) | 0;
    }
    const rle = rleEncode(raw);
    const useRle = rle.length < raw.length * 0.86;
    const bytes = useRle ? rle : raw;
    const b64 = bytesToBase64(bytes);
    const prefix = useRle ? HEIGHT_RLE_PREFIX : HEIGHT_PREFIX;
    return `${prefix}${this.simW},${this.simH},${b64}`;
  }

  async importDataUrl(dataUrl: string): Promise<void> {
    if (!dataUrl) throw new Error("sand image");
    if (dataUrl.startsWith(HEIGHT_PREFIX) || dataUrl.startsWith(HEIGHT_RLE_PREFIX)) {
      if (!this.importPacked(dataUrl)) throw new Error("sand image");
      return;
    }
    throw new Error("sand image");
  }

  flush(): boolean {
    if (!this.packNeeded) return false;
    this.packTexture();
    this.packNeeded = false;
    return true;
  }

  dirtyWorld(): { x0: number; z0: number; x1: number; z1: number } | "all" | null {
    if (!this.dirty) return null;
    const full = this.dirty.i0 <= 2 && this.dirty.j0 <= 2 && this.dirty.i1 >= this.simW - 3 && this.dirty.j1 >= this.simH - 3;
    if (full) return "all";
    return {
      x0: this.iToWorld(this.dirty.i0),
      z0: this.jToWorld(this.dirty.j0),
      x1: this.iToWorld(this.dirty.i1),
      z1: this.jToWorld(this.dirty.j1),
    };
  }

  private importPacked(payload: string): boolean {
    const rle = payload.startsWith(HEIGHT_RLE_PREFIX);
    const body = payload.slice(rle ? HEIGHT_RLE_PREFIX.length : HEIGHT_PREFIX.length);
    const comma1 = body.indexOf(",");
    const comma2 = body.indexOf(",", comma1 + 1);
    if (comma1 < 0 || comma2 < 0) return false;
    const w = Number(body.slice(0, comma1));
    const h = Number(body.slice(comma1 + 1, comma2));
    if (!w || !h || w > 512 || h > 512) return false;
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(body.slice(comma2 + 1));
    } catch {
      return false;
    }
    if (rle) bytes = rleDecode(bytes, w * h);
    if (bytes.length < w * h) return false;
    for (let j = 0; j < this.simH; j++) {
      for (let i = 0; i < this.simW; i++) {
        const u = (i / (this.simW - 1)) * (w - 1);
        const v = (j / (this.simH - 1)) * (h - 1);
        const x0 = Math.min(w - 1, Math.floor(u));
        const y0 = Math.min(h - 1, Math.floor(v));
        const x1 = Math.min(w - 1, x0 + 1);
        const y1 = Math.min(h - 1, y0 + 1);
        const fx = u - x0;
        const fy = v - y0;
        const h00 = bytes[y0 * w + x0];
        const h10 = bytes[y0 * w + x1];
        const h01 = bytes[y1 * w + x0];
        const h11 = bytes[y1 * w + x1];
        const lo = h00 * (1 - fx) + h10 * fx;
        const hi = h01 * (1 - fx) + h11 * fx;
        const packed = lo * (1 - fy) + hi * fy;
        this.height[j * this.simW + i] = H_MIN + (packed / 255) * H_RANGE;
      }
    }
    this.inferDirections();
    this.markAllDirty();
    this.packTexture();
    return true;
  }

  private inferDirections(): void {
    for (let j = 1; j < this.simH - 1; j++) {
      for (let i = 1; i < this.simW - 1; i++) {
        const idx = j * this.simW + i;
        const dx = this.height[idx + 1] - this.height[idx - 1];
        const dz = this.height[idx + this.simW] - this.height[idx - this.simW];
        const len = Math.hypot(dx, dz);
        if (len < 0.002) {
          this.dirX[idx] = 0;
          this.dirZ[idx] = 0;
        } else {
          this.dirX[idx] = -dz / len;
          this.dirZ[idx] = dx / len;
        }
      }
    }
  }

  private carveSegment(
    ax: number,
    az: number,
    bx: number,
    bz: number,
    blockers: Blocker[],
    depth: number,
    includeEnd: boolean,
  ): void {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.012) return;
    const tx = dx / len;
    const tz = dz / len;
    const nx = -tz;
    const nz = tx;
    const pad = TINES * TINE_GAP * 0.5 + RIDGE_OFF + this.cellMin * 3;
    const i0 = this.clampI(this.worldToI(Math.min(ax, bx) - pad));
    const i1 = this.clampI(this.worldToI(Math.max(ax, bx) + pad));
    const j0 = this.clampJ(this.worldToJ(Math.min(az, bz) - pad));
    const j1 = this.clampJ(this.worldToJ(Math.max(az, bz) + pad));
    const end = includeEnd ? len : len - 1e-6;

    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = this.iToWorld(i);
        const z = this.jToWorld(j);
        if (!this.clearOfBlockers(x, z, blockers)) continue;
        const t = (x - ax) * tx + (z - az) * tz;
        if (t < 0 || t > end) continue;
        const px = ax + tx * t;
        const pz = az + tz * t;
        const across = (x - px) * nx + (z - pz) * nz;
        const jag = 0.8 + hash2(i * 19 + 4, j * 23 + 9) * 0.42;
        const wobble = (hash2(i * 11, j * 13) - 0.5) * 0.014;
        const delta = tineProfile(across + wobble) * depth * jag;
        if (Math.abs(delta) < 1e-5) continue;
        const idx = j * this.simW + i;
        this.height[idx] += delta + (hash2(i + 3, j + 5) - 0.5) * 0.0028;
        this.dirX[idx] = this.dirX[idx] * 0.35 + tx * 0.65;
        this.dirZ[idx] = this.dirZ[idx] * 0.35 + tz * 0.65;
      }
    }
    this.expandDirty(i0, j0, i1, j1);
    this.marks.push({
      kind: "seg",
      ax,
      az,
      bx,
      bz,
      cx: 0,
      cz: 0,
      r: 0,
      a0: 0,
      a1: 0,
      depth,
      multi: true,
    });
  }

  private carveArc(
    cx: number,
    cz: number,
    radius: number,
    a0: number,
    a1: number,
    blockers: Blocker[],
    depth: number,
    single = false,
  ): void {
    let sweep = a1 - a0;
    while (sweep > Math.PI * 2) sweep -= Math.PI * 2;
    while (sweep < -Math.PI * 2) sweep += Math.PI * 2;
    if (Math.abs(sweep) < 0.008) return;
    const pad = TINES * TINE_GAP * 0.5 + RIDGE_OFF + this.cellMin * 3;
    const reach = radius + pad;
    const i0 = this.clampI(this.worldToI(cx - reach));
    const i1 = this.clampI(this.worldToI(cx + reach));
    const j0 = this.clampJ(this.worldToJ(cz - reach));
    const j1 = this.clampJ(this.worldToJ(cz + reach));

    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const x = this.iToWorld(i);
        const z = this.jToWorld(j);
        if (!this.clearOfBlockers(x, z, blockers)) continue;
        const dx = x - cx;
        const dz = z - cz;
        const dist = Math.hypot(dx, dz);
        const across = dist - radius;
        if (Math.abs(across) > pad) continue;
        let ang = Math.atan2(dz, dx);
        if (!angleInSweep(ang, a0, sweep)) continue;
        const jag = 0.8 + hash2(i * 19 + 4, j * 23 + 9) * 0.42;
        const wobble = (hash2(i * 11, j * 13) - 0.5) * 0.014;
        const delta = (single ? singleTine(across + wobble) : tineProfile(across + wobble)) * depth * jag;
        if (Math.abs(delta) < 1e-5) continue;
        const idx = j * this.simW + i;
        this.height[idx] += delta + (hash2(i + 3, j + 5) - 0.5) * 0.0028;
        const tx = -dz / (dist || 1);
        const tz = dx / (dist || 1);
        this.dirX[idx] = this.dirX[idx] * 0.35 + tx * 0.65;
        this.dirZ[idx] = this.dirZ[idx] * 0.35 + tz * 0.65;
      }
    }
    this.expandDirty(i0, j0, i1, j1);
    this.marks.push({
      kind: "arc",
      ax: 0,
      az: 0,
      bx: 0,
      bz: 0,
      cx,
      cz,
      r: radius,
      a0,
      a1,
      depth,
      multi: !single,
    });
  }

  private slumpRegion(rect: Rect, iterations: number): void {
    const maxDh = REPOSE * this.cellMin;
    const w = this.simW;
    const h = this.height;
    const i0 = Math.max(1, rect.i0);
    const i1 = Math.min(this.simW - 2, rect.i1);
    const j0 = Math.max(1, rect.j0);
    const j1 = Math.min(this.simH - 2, rect.j1);
    const neigh = [1, -1, w, -w];

    for (let it = 0; it < iterations; it++) {
      const jStart = it % 2 === 0 ? j0 : j1;
      const jEnd = it % 2 === 0 ? j1 : j0;
      const jStep = it % 2 === 0 ? 1 : -1;
      const iStart = it % 2 === 0 ? i0 : i1;
      const iEnd = it % 2 === 0 ? i1 : i0;
      const iStep = it % 2 === 0 ? 1 : -1;
      for (let j = jStart; j !== jEnd + jStep; j += jStep) {
        for (let i = iStart; i !== iEnd + iStep; i += iStep) {
          const idx = j * w + i;
          let steep = 0;
          let dest = idx;
          for (const off of neigh) {
            const dh = h[idx] - h[idx + off];
            if (dh > steep) {
              steep = dh;
              dest = idx + off;
            }
          }
          if (steep > maxDh) {
            const move = (steep - maxDh) * 0.32;
            h[idx] -= move;
            h[dest] += move;
          }
        }
      }
    }
    this.expandDirty(i0, j0, i1, j1);
  }

  private clampRect(rect: Rect): void {
    const i0 = Math.max(0, rect.i0);
    const i1 = Math.min(this.simW - 1, rect.i1);
    const j0 = Math.max(0, rect.j0);
    const j1 = Math.min(this.simH - 1, rect.j1);
    for (let j = j0; j <= j1; j++) {
      const row = j * this.simW;
      for (let i = i0; i <= i1; i++) {
        const v = this.height[row + i];
        this.height[row + i] = v < H_MIN ? H_MIN : v > H_MAX ? H_MAX : v;
      }
    }
  }

  private packTexture(): void {
    const { field, dispW, dispH, simW, simH } = this;
    const lastI = simW - 1;
    const lastJ = simH - 1;
    for (let j = 0; j < dispH; j++) {
      for (let i = 0; i < dispW; i++) {
        const fi = (i / Math.max(1, dispW - 1)) * lastI;
        const fj = (j / Math.max(1, dispH - 1)) * lastJ;
        let h = this.sampleBilinear(fi, fj);
        const ix = this.clampI(Math.floor(fi));
        const jz = this.clampJ(Math.floor(fj));
        const dx = this.sampleDirX(ix, jz);
        const dz = this.sampleDirZ(ix, jz);
        const o = (j * dispW + i) * 4;
        const t = (h - H_MIN) / H_RANGE;
        field[o] = t <= 0 ? 0 : t >= 1 ? 255 : (t * 255 + 0.5) | 0;
        field[o + 1] = ((dx * 0.5 + 0.5) * 255 + 0.5) | 0;
        field[o + 2] = ((dz * 0.5 + 0.5) * 255 + 0.5) | 0;
        field[o + 3] = 255;
      }
    }
    this.texture.needsUpdate = true;
  }

  private sampleDirX(i: number, j: number): number {
    return this.dirX[j * this.simW + i];
  }

  private sampleDirZ(i: number, j: number): number {
    return this.dirZ[j * this.simW + i];
  }

  private sampleBilinear(fi: number, fj: number): number {
    const x0 = this.clampI(Math.floor(fi));
    const y0 = this.clampJ(Math.floor(fj));
    const x1 = this.clampI(x0 + 1);
    const y1 = this.clampJ(y0 + 1);
    const fx = fi - Math.floor(fi);
    const fy = fj - Math.floor(fj);
    const h00 = this.height[y0 * this.simW + x0];
    const h10 = this.height[y0 * this.simW + x1];
    const h01 = this.height[y1 * this.simW + x0];
    const h11 = this.height[y1 * this.simW + y1 * 0 + x1];
    return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
  }

  private worldToI(x: number): number {
    return ((x / GARDEN.width + 0.5) * (this.simW - 1) + 0.5) | 0;
  }

  private worldToJ(z: number): number {
    return ((z / GARDEN.depth + 0.5) * (this.simH - 1) + 0.5) | 0;
  }

  private iToWorld(i: number): number {
    return (i / (this.simW - 1) - 0.5) * GARDEN.width;
  }

  private jToWorld(j: number): number {
    return (j / (this.simH - 1) - 0.5) * GARDEN.depth;
  }

  private clampI(i: number): number {
    return i < 0 ? 0 : i > this.simW - 1 ? this.simW - 1 : i;
  }

  private clampJ(j: number): number {
    return j < 0 ? 0 : j > this.simH - 1 ? this.simH - 1 : j;
  }

  private fullRect(): Rect {
    return { i0: 1, j0: 1, i1: this.simW - 2, j1: this.simH - 2 };
  }

  private markAllDirty(): void {
    this.dirty = this.fullRect();
    this.slumpRect = copyRect(this.dirty);
    this.packNeeded = true;
  }

  private expandDirty(i0: number, j0: number, i1: number, j1: number): void {
    if (!this.dirty) {
      this.dirty = { i0, j0, i1, j1 };
    } else {
      this.dirty.i0 = Math.min(this.dirty.i0, i0);
      this.dirty.j0 = Math.min(this.dirty.j0, j0);
      this.dirty.i1 = Math.max(this.dirty.i1, i1);
      this.dirty.j1 = Math.max(this.dirty.j1, j1);
    }
    this.slumpRect = this.slumpRect ? unionRect(this.slumpRect, this.dirty) : copyRect(this.dirty);
    this.packNeeded = true;
  }

  private clearOfBlockers(x: number, z: number, blockers: Blocker[]): boolean {
    for (const b of blockers) {
      if ((x - b.x) * (x - b.x) + (z - b.z) * (z - b.z) < b.r * b.r) return false;
    }
    return true;
  }
}

function hash2(x: number, y: number): number {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function singleTine(across: number): number {
  const trough = Math.exp(-0.5 * (across / TROUGH_SIGMA) ** 2);
  const ridge =
    Math.exp(-0.5 * ((across - RIDGE_OFF) / RIDGE_SIGMA) ** 2) +
    Math.exp(-0.5 * ((across + RIDGE_OFF) / RIDGE_SIGMA) ** 2);
  return -trough + (TROUGH_SIGMA / (2 * RIDGE_SIGMA)) * ridge;
}

function markDelta(mark: RakeMark, x: number, z: number): number {
  if (mark.kind === "seg") {
    const dx = mark.bx - mark.ax;
    const dz = mark.bz - mark.az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return 0;
    const tx = dx / len;
    const tz = dz / len;
    const t = (x - mark.ax) * tx + (z - mark.az) * tz;
    if (t < -0.02 || t > len + 0.02) return 0;
    const across = (x - mark.ax) * -tz + (z - mark.az) * tx;
    const pad = mark.multi ? TINES * TINE_GAP * 0.5 + RIDGE_OFF + 0.05 : RIDGE_OFF + TROUGH_SIGMA * 3;
    if (Math.abs(across) > pad) return 0;
    return (mark.multi ? tineProfile(across) : singleTine(across)) * mark.depth;
  }
  const dx = x - mark.cx;
  const dz = z - mark.cz;
  const dist = Math.hypot(dx, dz);
  const across = dist - mark.r;
  const pad = mark.multi ? TINES * TINE_GAP * 0.5 + RIDGE_OFF + 0.05 : RIDGE_OFF + TROUGH_SIGMA * 3;
  if (Math.abs(across) > pad) return 0;
  const sweep = mark.a1 - mark.a0;
  if (!angleInSweep(Math.atan2(dz, dx), mark.a0, sweep)) return 0;
  return (mark.multi ? tineProfile(across) : singleTine(across)) * mark.depth;
}

function ridgeOffsets(multi: boolean): number[] {
  if (!multi) return [RIDGE_OFF, -RIDGE_OFF];
  const out: number[] = [];
  const center = (TINES - 1) / 2;
  for (let t = 0; t < TINES; t++) {
    const mid = (t - center) * TINE_GAP;
    out.push(mid + RIDGE_OFF, mid - RIDGE_OFF);
  }
  return out;
}

function troughOffsets(multi: boolean): number[] {
  if (!multi) return [0];
  const out: number[] = [];
  const center = (TINES - 1) / 2;
  for (let t = 0; t < TINES; t++) out.push((t - center) * TINE_GAP);
  return out;
}

function tineProfile(across: number): number {
  let trough = 0;
  let ridge = 0;
  const center = (TINES - 1) / 2;
  for (let t = 0; t < TINES; t++) {
    const off = (t - center) * TINE_GAP;
    const d = across - off;
    trough += Math.exp(-0.5 * (d / TROUGH_SIGMA) ** 2);
    ridge += Math.exp(-0.5 * ((d - RIDGE_OFF) / RIDGE_SIGMA) ** 2);
    ridge += Math.exp(-0.5 * ((d + RIDGE_OFF) / RIDGE_SIGMA) ** 2);
  }
  const a = 1;
  const b = (a * TROUGH_SIGMA) / (2 * RIDGE_SIGMA);
  return -a * trough + b * ridge;
}

function angleInSweep(ang: number, a0: number, sweep: number): boolean {
  if (Math.abs(sweep) >= Math.PI * 2 - 1e-3) return true;
  let d = ang - a0;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (sweep >= 0) return d >= -0.02 && d <= sweep + 0.02;
  return d <= 0.02 && d >= sweep - 0.02;
}

function copyRect(r: Rect): Rect {
  return { i0: r.i0, j0: r.j0, i1: r.i1, j1: r.j1 };
}

function unionRect(a: Rect, b: Rect): Rect {
  return {
    i0: Math.min(a.i0, b.i0),
    j0: Math.min(a.j0, b.j0),
    i1: Math.max(a.i1, b.i1),
    j1: Math.max(a.j1, b.j1),
  };
}

function stddev(values: number[]): number {
  if (!values.length) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function rleEncode(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < src.length) {
    const v = src[i];
    let run = 1;
    while (i + run < src.length && src[i + run] === v && run < 255) run += 1;
    if (run >= 4 || v === 255) {
      out.push(255, run, v);
      i += run;
    } else {
      for (let k = 0; k < run; k++) out.push(src[i + k]);
      i += run;
    }
  }
  return new Uint8Array(out);
}

function rleDecode(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let i = 0;
  let o = 0;
  while (i < src.length && o < expected) {
    const v = src[i++];
    if (v === 255 && i + 1 < src.length) {
      const run = src[i++];
      const val = src[i++];
      for (let k = 0; k < run && o < expected; k++) out[o++] = val;
    } else {
      out[o++] = v;
    }
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let bin = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
