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
      bumpScale: 0.42,
      displacementMap: this.texture,
      displacementScale: 0.038,
      roughness: 0.97,
      metalness: 0,
      color: 0xe8e4dc,
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
    g.addColorStop(0, "#d8d4cc");
    g.addColorStop(0.48, "#e4e0d8");
    g.addColorStop(1, "#ccc8c0");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < 22000; i++) {
      const x = rng() * canvas.width;
      const y = rng() * canvas.height;
      const a = 0.028 + rng() * 0.07;
      const cool = rng() > 0.5;
      ctx.fillStyle = cool ? `rgba(72,70,66,${a})` : `rgba(248,246,240,${a})`;
      ctx.fillRect(x, y, 1, 1);
    }
    for (let i = 0; i < 2800; i++) {
      const x = rng() * canvas.width;
      const y = rng() * canvas.height;
      const a = 0.04 + rng() * 0.08;
      ctx.fillStyle = rng() > 0.55 ? `rgba(96,94,88,${a})` : `rgba(236,232,224,${a})`;
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
      ctx.strokeStyle = `rgba(58, 56, 52, ${0.2 + depth * 0.22})`;
      ctx.lineWidth = 1.35 + depth * 1.45;
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

  paintRing(wx: number, wz: number, radiusWorld: number, tineGap = 0.2): void {
    const c = this.worldToUv(wx, wz);
    const maxR = (radiusWorld / GARDEN.width) * TEX_W;
    const gap = (tineGap / GARDEN.width) * TEX_W;
    const ctx = this.ctx;
    const sides = 16;
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    for (let r = gap * 1.55; r < maxR; r += gap * 1.75) {
      this.strokePolygon(c.u, c.v, r, sides, "rgba(58, 56, 52, 0.26)", 2.15);
      this.strokePolygon(c.u, c.v, r + 1.7, sides, "rgba(248, 246, 240, 0.14)", 1.05);
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
      ctx.strokeStyle = "rgba(58, 56, 52, 0.2)";
      ctx.lineWidth = 2.05;
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
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = a.u + dx * t;
      const cy = a.v + dy * t;
      let best = 0;
      let bestDark = 999;
      for (let o = -10; o <= 10; o++) {
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
      offsets.push(best);
    }
    const mean = offsets.reduce((s, v) => s + v, 0) / offsets.length;
    const variance = offsets.reduce((s, v) => s + (v - mean) ** 2, 0) / offsets.length;
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

  private strokePolygon(cx: number, cy: number, radius: number, sides: number, color: string, width: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(a) * radius;
      const y = cy + Math.sin(a) * radius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
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
