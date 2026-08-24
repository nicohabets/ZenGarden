import * as THREE from "three";
import { GARDEN, type Blocker, type SandTone } from "./types";
import { mulberry32 } from "./rng";

const TEX_W = 2048;
const TEX_H = 1280;
/** Keep groove-sample APIs in the original 1024-wide pixel space. */
const SAMPLE_SCALE = TEX_W / 1024;
const PX_PER_WORLD_X = TEX_W / GARDEN.width;

export class SandField {
  readonly mesh: THREE.Mesh;
  readonly texture: THREE.CanvasTexture;
  readonly heightTexture: THREE.CanvasTexture;
  readonly canvas: HTMLCanvasElement;
  private readonly heightCanvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly heightCtx: CanvasRenderingContext2D;
  private dirty = false;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = TEX_W;
    this.canvas.height = TEX_H;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Could not create sand canvas");
    this.ctx = ctx;

    this.heightCanvas = document.createElement("canvas");
    this.heightCanvas.width = TEX_W;
    this.heightCanvas.height = TEX_H;
    const heightCtx = this.heightCanvas.getContext("2d", { willReadFrequently: true });
    if (!heightCtx) throw new Error("Could not create sand height canvas");
    this.heightCtx = heightCtx;

    this.paintBase(0x9e3779b9);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = true;

    this.heightTexture = new THREE.CanvasTexture(this.heightCanvas);
    this.heightTexture.colorSpace = THREE.NoColorSpace;
    this.heightTexture.anisotropy = 8;
    this.heightTexture.wrapS = THREE.ClampToEdgeWrapping;
    this.heightTexture.wrapT = THREE.ClampToEdgeWrapping;
    this.heightTexture.minFilter = THREE.LinearMipmapLinearFilter;
    this.heightTexture.magFilter = THREE.LinearFilter;
    this.heightTexture.generateMipmaps = true;

    const geo = new THREE.PlaneGeometry(GARDEN.width, GARDEN.depth, 260, 152);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      map: this.texture,
      bumpMap: this.heightTexture,
      bumpScale: 1.15,
      displacementMap: this.heightTexture,
      displacementScale: 0.042,
      displacementBias: -0.016,
      roughness: 0.93,
      metalness: 0,
      color: 0xf7f4ed,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = GARDEN.sandY;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = true;
    this.mesh.userData.kind = "sand";
  }

  paintBase(seed: number): void {
    const { ctx, canvas } = this;
    const rng = mulberry32(seed);
    const g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    g.addColorStop(0, "#eceae4");
    g.addColorStop(0.48, "#f5f2eb");
    g.addColorStop(1, "#e4e1d8");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.scatterGrains(ctx, rng, false);
    this.paintHeightBase(seed);
    this.markDirty();
  }

  worldToUv(x: number, z: number): { u: number; v: number } {
    return {
      u: (x / GARDEN.width + 0.5) * TEX_W,
      v: (z / GARDEN.depth + 0.5) * TEX_H,
    };
  }

  rake(fromX: number, fromZ: number, toX: number, toZ: number, blockers: Blocker[]): void {
    const a = this.worldToUv(fromX, fromZ);
    const b = this.worldToUv(toX, toZ);
    const dx = b.u - a.u;
    const dy = b.v - a.v;
    const len = Math.hypot(dx, dy);
    if (len < 1.2 * SAMPLE_SCALE) return;
    if (!this.clearOfBlockers(fromX, fromZ, blockers) || !this.clearOfBlockers(toX, toZ, blockers)) {
      return;
    }

    const nx = -dy / len;
    const ny = dx / len;
    const tines = 7;
    const spacing = 0.057 * PX_PER_WORLD_X;
    this.strokeTines(a.u, a.v, b.u, b.v, nx, ny, tines, spacing);
    this.markDirty();
  }

  rakeArc(
    cx: number,
    cz: number,
    radius: number,
    a0: number,
    a1: number,
    blockers: Blocker[],
  ): void {
    const sweep = a1 - a0;
    if (Math.abs(sweep) < 0.008 || radius < 0.12) return;
    const steps = Math.max(3, Math.ceil(radius * Math.abs(sweep) * 18));
    const tines = 7;
    const spacing = 0.055;
    for (let t = 0; t < tines; t++) {
      const center = (tines - 1) / 2;
      const r = radius + (t - center) * spacing;
      if (r < 0.1) continue;
      const depth = 1 - Math.abs(t - center) / (center + 0.01);
      this.strokeWorldGrooveArc(cx, cz, r, a0, a1, steps, blockers, depth);
    }
    this.markDirty();
  }

  paintRing(wx: number, wz: number, radiusWorld: number, innerWorld = 0.42, tineGap = 0.165): void {
    for (let r = innerWorld + tineGap; r < radiusWorld; r += tineGap) {
      this.strokeWorldGrooveCircle(wx, wz, r, 0.82);
    }
    this.markDirty();
  }

  paintParallel(seed: number): void {
    const rng = mulberry32(seed ^ 0x51ed);
    const gap = (11 + Math.floor(rng() * 3)) * SAMPLE_SCALE;
    const inset = 18 * SAMPLE_SCALE;
    for (let y = inset; y < TEX_H - inset; y += gap) {
      this.strokePixelGroove(inset, y, TEX_W - inset, y, 0.7);
    }
    this.markDirty();
  }

  getSandTone(): SandTone {
    this.flush();
    const img = this.ctx.getImageData(0, 0, TEX_W, TEX_H);
    let r = 0;
    let g = 0;
    let b = 0;
    const step = 32;
    let n = 0;
    for (let y = 8; y < TEX_H; y += step) {
      for (let x = 8; x < TEX_W; x += step) {
        const i = (y * TEX_W + x) * 4;
        r += img.data[i];
        g += img.data[i + 1];
        b += img.data[i + 2];
        n += 1;
      }
    }
    r /= n;
    g /= n;
    b /= n;
    return { r, g, b, luma: r * 0.3 + g * 0.59 + b * 0.11 };
  }

  sampleGrooveDeviation(fromX: number, fromZ: number, toX: number, toZ: number): number {
    this.flush();
    const a = this.worldToUv(fromX, fromZ);
    const b = this.worldToUv(toX, toZ);
    const dx = b.u - a.u;
    const dy = b.v - a.v;
    const len = Math.hypot(dx, dy);
    if (len < 8 * SAMPLE_SCALE) return 0;
    const nx = -dy / len;
    const ny = dx / len;
    const img = this.ctx.getImageData(0, 0, TEX_W, TEX_H);
    const offsets: number[] = [];
    const steps = Math.max(8, Math.floor(len / (5 * SAMPLE_SCALE)));
    let prev = 0;
    const win0 = 12 * SAMPLE_SCALE;
    const win = 3 * SAMPLE_SCALE;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = a.u + dx * t;
      const cy = a.v + dy * t;
      let best = prev;
      let bestDark = 999;
      const lo = i === 0 ? -win0 : prev - win;
      const hi = i === 0 ? win0 : prev + win;
      for (let o = lo; o <= hi; o += 1) {
        const x = Math.round(cx + nx * o);
        const y = Math.round(cy + ny * o);
        if (x < 0 || y < 0 || x >= TEX_W || y >= TEX_H) continue;
        const idx = (y * TEX_W + x) * 4;
        const luma = img.data[idx] * 0.3 + img.data[idx + 1] * 0.59 + img.data[idx + 2] * 0.11;
        if (luma < bestDark) {
          bestDark = luma;
          best = o;
        }
      }
      prev = best;
      offsets.push(best / SAMPLE_SCALE);
    }
    const mean = offsets.reduce((s, v) => s + v, 0) / offsets.length;
    const variance = offsets.reduce((s, v) => s + (v - mean) ** 2, 0) / offsets.length;
    return Math.sqrt(variance);
  }

  sampleArcDeviation(cx: number, cz: number, radius: number, a0 = 0, a1 = Math.PI * 2): number {
    this.flush();
    const img = this.ctx.getImageData(0, 0, TEX_W, TEX_H);
    const steps = 36;
    const radii: number[] = [];
    let prev = 0;
    const win0 = 8 * SAMPLE_SCALE;
    const win = 3 * SAMPLE_SCALE;
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      const px = cx + Math.cos(a) * radius;
      const pz = cz + Math.sin(a) * radius;
      const uv = this.worldToUv(px, pz);
      const inward = this.worldToUv(cx + Math.cos(a) * (radius - 0.2), cz + Math.sin(a) * (radius - 0.2));
      const nx = uv.u - inward.u;
      const ny = uv.v - inward.v;
      const nlen = Math.hypot(nx, ny) || 1;
      let best = prev;
      let bestDark = 999;
      const lo = i === 0 ? -win0 : prev - win;
      const hi = i === 0 ? win0 : prev + win;
      for (let o = lo; o <= hi; o += 1) {
        const x = Math.round(uv.u + (nx / nlen) * o);
        const y = Math.round(uv.v + (ny / nlen) * o);
        if (x < 0 || y < 0 || x >= TEX_W || y >= TEX_H) continue;
        const idx = (y * TEX_W + x) * 4;
        const luma = img.data[idx] * 0.3 + img.data[idx + 1] * 0.59 + img.data[idx + 2] * 0.11;
        if (luma < bestDark) {
          bestDark = luma;
          best = o;
        }
      }
      prev = best;
      radii.push(best / SAMPLE_SCALE);
    }
    const mean = radii.reduce((s, v) => s + v, 0) / radii.length;
    const variance = radii.reduce((s, v) => s + (v - mean) ** 2, 0) / radii.length;
    return Math.sqrt(variance);
  }

  exportDataUrl(): string {
    this.flush();
    return this.canvas.toDataURL("image/jpeg", 0.68);
  }

  async importDataUrl(dataUrl: string): Promise<void> {
    if (!dataUrl) return;
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("sand image"));
      img.src = dataUrl;
    });
    this.ctx.drawImage(img, 0, 0, TEX_W, TEX_H);
    this.rebuildHeightFromColor();
    this.markDirty();
    this.flush();
  }

  flush(): void {
    if (!this.dirty) return;
    this.texture.needsUpdate = true;
    this.heightTexture.needsUpdate = true;
    this.dirty = false;
  }

  private paintHeightBase(seed: number): void {
    const ctx = this.heightCtx;
    ctx.fillStyle = "#8e8e8e";
    ctx.fillRect(0, 0, TEX_W, TEX_H);
    this.scatterGrains(ctx, mulberry32(seed ^ 0x51edc07), true);
  }

  private scatterGrains(ctx: CanvasRenderingContext2D, rng: () => number, height: boolean): void {
    const img = ctx.getImageData(0, 0, TEX_W, TEX_H);
    const data = img.data;
    const fine = 145000;
    for (let i = 0; i < fine; i++) {
      const x = (rng() * TEX_W) | 0;
      const y = (rng() * TEX_H) | 0;
      const idx = (y * TEX_W + x) * 4;
      if (height) {
        const d = rng() > 0.5 ? 18 + rng() * 22 : -(12 + rng() * 20);
        data[idx] = clampByte(data[idx] + d);
        data[idx + 1] = data[idx];
        data[idx + 2] = data[idx];
      } else {
        const cool = rng() > 0.5;
        const a = 0.045 + rng() * 0.1;
        const src = cool ? [88, 86, 82] : [255, 253, 248];
        data[idx] = Math.round(data[idx] * (1 - a) + src[0] * a);
        data[idx + 1] = Math.round(data[idx + 1] * (1 - a) + src[1] * a);
        data[idx + 2] = Math.round(data[idx + 2] * (1 - a) + src[2] * a);
      }
    }
    const pebbles = 5200;
    for (let i = 0; i < pebbles; i++) {
      const x = (rng() * TEX_W) | 0;
      const y = (rng() * TEX_H) | 0;
      const w = 1 + ((rng() * 2) | 0);
      const h = 1 + ((rng() * 1.5) | 0);
      const light = rng() > 0.55;
      for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < w; xx++) {
          const px = x + xx;
          const py = y + yy;
          if (px < 0 || py < 0 || px >= TEX_W || py >= TEX_H) continue;
          const idx = (py * TEX_W + px) * 4;
          if (height) {
            const d = light ? 16 : -18;
            data[idx] = clampByte(data[idx] + d);
            data[idx + 1] = data[idx];
            data[idx + 2] = data[idx];
          } else {
            const a = 0.06 + rng() * 0.1;
            const src = light ? [246, 244, 238] : [104, 102, 96];
            data[idx] = Math.round(data[idx] * (1 - a) + src[0] * a);
            data[idx + 1] = Math.round(data[idx + 1] * (1 - a) + src[1] * a);
            data[idx + 2] = Math.round(data[idx + 2] * (1 - a) + src[2] * a);
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  private rebuildHeightFromColor(): void {
    const color = this.ctx.getImageData(0, 0, TEX_W, TEX_H);
    const height = this.heightCtx.createImageData(TEX_W, TEX_H);
    for (let i = 0; i < color.data.length; i += 4) {
      const luma = color.data[i] * 0.3 + color.data[i + 1] * 0.59 + color.data[i + 2] * 0.11;
      const h = clampByte(48 + (luma / 255) * 168);
      height.data[i] = h;
      height.data[i + 1] = h;
      height.data[i + 2] = h;
      height.data[i + 3] = 255;
    }
    this.heightCtx.putImageData(height, 0, 0);
  }

  private strokeTines(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    nx: number,
    ny: number,
    tines: number,
    spacing: number,
  ): void {
    const center = (tines - 1) / 2;
    for (let t = 0; t < tines; t++) {
      const off = (t - center) * spacing;
      const depth = 1 - Math.abs(t - center) / (center + 0.01);
      this.strokePixelGroove(ax + nx * off, ay + ny * off, bx + nx * off, by + ny * off, depth);
    }
  }

  private strokePixelGroove(ax: number, ay: number, bx: number, by: number, depth: number): void {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const ridge = 1.7 * SAMPLE_SCALE;

    this.strokeOn(this.ctx, ax, ay, bx, by, `rgba(72, 70, 64, ${0.2 + depth * 0.22})`, 1.7 * SAMPLE_SCALE + depth * 1.5 * SAMPLE_SCALE);
    this.strokeOn(
      this.ctx,
      ax + nx * 1.5 * SAMPLE_SCALE,
      ay + ny * 1.5 * SAMPLE_SCALE,
      bx + nx * 1.5 * SAMPLE_SCALE,
      by + ny * 1.5 * SAMPLE_SCALE,
      `rgba(250, 248, 242, ${0.12 + depth * 0.16})`,
      1.15 * SAMPLE_SCALE,
    );

    this.heightCtx.filter = "blur(0.7px)";
    this.strokeOn(this.heightCtx, ax, ay, bx, by, `rgba(42, 42, 42, ${0.42 + depth * 0.38})`, 3.1 * SAMPLE_SCALE + depth * 1.4 * SAMPLE_SCALE);
    this.strokeOn(
      this.heightCtx,
      ax + nx * ridge,
      ay + ny * ridge,
      bx + nx * ridge,
      by + ny * ridge,
      `rgba(214, 214, 214, ${0.28 + depth * 0.28})`,
      1.7 * SAMPLE_SCALE,
    );
    this.heightCtx.filter = "none";
  }

  private strokeWorldGrooveCircle(wx: number, wz: number, radius: number, depth: number): void {
    this.strokeWorldGrooveArc(wx, wz, radius, 0, Math.PI * 2, Math.max(40, Math.ceil(radius * 42)), [], depth);
  }

  private strokeWorldGrooveArc(
    cx: number,
    cz: number,
    radius: number,
    a0: number,
    a1: number,
    steps: number,
    blockers: Blocker[],
    depth: number,
  ): void {
    this.traceWorldArc(this.ctx, cx, cz, radius, a0, a1, steps, blockers, `rgba(66, 64, 58, ${0.22 + depth * 0.24})`, 1.9 * SAMPLE_SCALE + depth * 1.5 * SAMPLE_SCALE);
    this.traceWorldArc(this.ctx, cx, cz, radius + 0.018, a0, a1, steps, blockers, `rgba(252, 250, 244, ${0.11 + depth * 0.14})`, 1.15 * SAMPLE_SCALE);
    this.heightCtx.filter = "blur(0.7px)";
    this.traceWorldArc(this.heightCtx, cx, cz, radius, a0, a1, steps, blockers, `rgba(40, 40, 40, ${0.44 + depth * 0.36})`, 3.2 * SAMPLE_SCALE + depth * 1.35 * SAMPLE_SCALE);
    this.traceWorldArc(this.heightCtx, cx, cz, radius + 0.02, a0, a1, steps, blockers, `rgba(216, 216, 216, ${0.28 + depth * 0.26})`, 1.7 * SAMPLE_SCALE);
    this.heightCtx.filter = "none";
  }

  private strokeOn(
    ctx: CanvasRenderingContext2D,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    color: string,
    width: number,
  ): void {
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  private traceWorldArc(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cz: number,
    radius: number,
    a0: number,
    a1: number,
    steps: number,
    blockers: Blocker[],
    color: string,
    width: number,
  ): void {
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    let drawing = false;
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      const x = cx + Math.cos(a) * radius;
      const z = cz + Math.sin(a) * radius;
      if (!this.clearOfBlockers(x, z, blockers)) {
        drawing = false;
        continue;
      }
      const uv = this.worldToUv(x, z);
      if (!drawing) {
        ctx.beginPath();
        ctx.moveTo(uv.u, uv.v);
        drawing = true;
      } else {
        ctx.lineTo(uv.u, uv.v);
      }
    }
    if (drawing) ctx.stroke();
  }

  private markDirty(): void {
    this.dirty = true;
  }

  private clearOfBlockers(x: number, z: number, blockers: Blocker[]): boolean {
    for (const b of blockers) {
      if ((x - b.x) * (x - b.x) + (z - b.z) * (z - b.z) < b.r * b.r) return false;
    }
    return true;
  }
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, v | 0));
}
