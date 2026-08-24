import * as THREE from "three";
import { GARDEN, type Blocker, type SandTone } from "./types";
import { mulberry32 } from "./rng";

const TEX_W = 1024;
const TEX_H = 640;

export class SandField {
  readonly mesh: THREE.Mesh;
  readonly texture: THREE.CanvasTexture;
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private dirty = false;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = TEX_W;
    this.canvas.height = TEX_H;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Could not create sand canvas");
    this.ctx = ctx;

    this.paintBase(0x9e3779b9);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = true;

    const geo = new THREE.PlaneGeometry(GARDEN.width, GARDEN.depth, 140, 88);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      map: this.texture,
      bumpMap: this.texture,
      bumpScale: 0.28,
      displacementMap: this.texture,
      displacementScale: 0.02,
      roughness: 0.98,
      metalness: 0,
      color: 0xf6f3ec,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = GARDEN.sandY;
    this.mesh.receiveShadow = true;
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

    for (let i = 0; i < 26000; i++) {
      const x = rng() * canvas.width;
      const y = rng() * canvas.height;
      const a = 0.02 + rng() * 0.05;
      const cool = rng() > 0.5;
      ctx.fillStyle = cool ? `rgba(92,90,86,${a})` : `rgba(255,253,248,${a})`;
      ctx.fillRect(x, y, 1, 1);
    }
    for (let i = 0; i < 2200; i++) {
      const x = rng() * canvas.width;
      const y = rng() * canvas.height;
      const a = 0.03 + rng() * 0.06;
      ctx.fillStyle = rng() > 0.55 ? `rgba(110,108,102,${a})` : `rgba(244,242,236,${a})`;
      ctx.fillRect(x, y, 1 + rng(), 1);
    }
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
    if (len < 1.2) return;
    if (!this.clearOfBlockers(fromX, fromZ, blockers) || !this.clearOfBlockers(toX, toZ, blockers)) {
      return;
    }

    const nx = -dy / len;
    const ny = dx / len;
    const tines = 7;
    const spacing = 4.15;
    const ctx = this.ctx;
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";

    for (let t = 0; t < tines; t++) {
      const center = (tines - 1) / 2;
      const off = (t - center) * spacing;
      const depth = 1 - Math.abs(t - center) / (center + 0.01);
      const ox = nx * off;
      const oy = ny * off;
      ctx.strokeStyle = `rgba(78, 76, 70, ${0.16 + depth * 0.18})`;
      ctx.lineWidth = 1.25 + depth * 1.25;
      ctx.beginPath();
      ctx.moveTo(a.u + ox, a.v + oy);
      ctx.lineTo(b.u + ox, b.v + oy);
      ctx.stroke();

      ctx.strokeStyle = `rgba(248, 246, 240, ${0.1 + depth * 0.14})`;
      ctx.lineWidth = 0.95;
      ctx.beginPath();
      ctx.moveTo(a.u + ox + nx * 1.45, a.v + oy + ny * 1.45);
      ctx.lineTo(b.u + ox + nx * 1.45, b.v + oy + ny * 1.45);
      ctx.stroke();
    }
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
    const ctx = this.ctx;
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";

    for (let t = 0; t < tines; t++) {
      const center = (tines - 1) / 2;
      const r = radius + (t - center) * spacing;
      if (r < 0.1) continue;
      const depth = 1 - Math.abs(t - center) / (center + 0.01);
      this.strokeWorldArc(cx, cz, r, a0, a1, steps, blockers, `rgba(70, 68, 62, ${0.2 + depth * 0.2})`, 1.35 + depth * 1.35);
      this.strokeWorldArc(cx, cz, r + 0.018, a0, a1, steps, blockers, `rgba(252, 250, 244, ${0.1 + depth * 0.12})`, 0.95);
    }
    this.markDirty();
  }

  paintRing(wx: number, wz: number, radiusWorld: number, innerWorld = 0.42, tineGap = 0.165): void {
    const ctx = this.ctx;
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    for (let r = innerWorld + tineGap; r < radiusWorld; r += tineGap) {
      this.strokeWorldCircle(wx, wz, r, "rgba(70, 68, 62, 0.26)", 2.15);
      this.strokeWorldCircle(wx, wz, r + 0.02, "rgba(255, 252, 246, 0.13)", 1);
    }
    this.markDirty();
  }

  paintParallel(seed: number): void {
    const rng = mulberry32(seed ^ 0x51ed);
    const ctx = this.ctx;
    const gap = 11 + Math.floor(rng() * 3);
    const inset = 18;
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    for (let y = inset; y < TEX_H - inset; y += gap) {
      ctx.strokeStyle = "rgba(78, 76, 70, 0.16)";
      ctx.lineWidth = 1.85;
      ctx.beginPath();
      ctx.moveTo(inset, y);
      ctx.lineTo(TEX_W - inset, y);
      ctx.stroke();
      ctx.strokeStyle = "rgba(248, 246, 240, 0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(inset, y + 1.6);
      ctx.lineTo(TEX_W - inset, y + 1.6);
      ctx.stroke();
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
    if (len < 8) return 0;
    const nx = -dy / len;
    const ny = dx / len;
    const img = this.ctx.getImageData(0, 0, TEX_W, TEX_H);
    const offsets: number[] = [];
    const steps = Math.max(8, Math.floor(len / 5));
    let prev = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = a.u + dx * t;
      const cy = a.v + dy * t;
      let best = prev;
      let bestDark = 999;
      const lo = i === 0 ? -12 : prev - 3;
      const hi = i === 0 ? 12 : prev + 3;
      for (let o = lo; o <= hi; o++) {
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
      offsets.push(best);
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
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      const px = cx + Math.cos(a) * radius;
      const pz = cz + Math.sin(a) * radius;
      const uv = this.worldToUv(px, pz);
      const inward = this.worldToUv(cx + Math.cos(a) * (radius - 0.2), cz + Math.sin(a) * (radius - 0.2));
      const nx = uv.u - inward.u;
      const ny = uv.v - inward.v;
      const nlen = Math.hypot(nx, ny) || 1;
      let best = 0;
      let bestDark = 999;
      for (let o = -10; o <= 10; o++) {
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
      radii.push(best);
    }
    const mean = radii.reduce((s, v) => s + v, 0) / radii.length;
    const variance = radii.reduce((s, v) => s + (v - mean) ** 2, 0) / radii.length;
    return Math.sqrt(variance);
  }

  exportDataUrl(): string {
    this.flush();
    return this.canvas.toDataURL("image/jpeg", 0.72);
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
    this.markDirty();
    this.flush();
  }

  flush(): void {
    if (!this.dirty) return;
    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  private strokeWorldCircle(wx: number, wz: number, radius: number, color: string, width: number): void {
    this.strokeWorldArc(wx, wz, radius, 0, Math.PI * 2, Math.max(40, Math.ceil(radius * 42)), [], color, width);
  }

  private strokeWorldArc(
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
    const ctx = this.ctx;
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
