import * as THREE from "three";
import { GARDEN, type Blocker } from "./types";
import { mulberry32 } from "./rng";

const TEX_W = 768;
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
    const ctx = this.canvas.getContext("2d", { willReadFrequently: false });
    if (!ctx) throw new Error("Could not create sand canvas");
    this.ctx = ctx;

    this.paintBase(0x9e3779b9);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;

    const geo = new THREE.PlaneGeometry(GARDEN.width, GARDEN.depth, 96, 80);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      map: this.texture,
      bumpMap: this.texture,
      bumpScale: 0.58,
      displacementMap: this.texture,
      displacementScale: 0.078,
      roughness: 0.94,
      metalness: 0.02,
      color: 0xf3e6c8,
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
    g.addColorStop(0, "#d8c39a");
    g.addColorStop(0.45, "#e2cc9f");
    g.addColorStop(1, "#c9b17f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < 4200; i++) {
      const x = rng() * canvas.width;
      const y = rng() * canvas.height;
      const a = 0.035 + rng() * 0.07;
      ctx.fillStyle = rng() > 0.5 ? `rgba(90,70,40,${a})` : `rgba(255,240,210,${a})`;
      ctx.fillRect(x, y, 1 + rng() * 2, 1 + rng() * 1.5);
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
    const spacing = 4.35;
    const ctx = this.ctx;
    const wave = 1.15;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const stroke = (ox: number, oy: number, width: number, color: string, wobble: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      const steps = Math.max(2, Math.ceil(len / 6));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const px = a.u + dx * t + ox + nx * Math.sin(t * Math.PI * 2 + len) * wobble;
        const py = a.v + dy * t + oy + ny * Math.sin(t * Math.PI * 2 + len) * wobble;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    };

    for (let t = 0; t < tines; t++) {
      const center = (tines - 1) / 2;
      const off = (t - center) * spacing;
      const depth = 1 - Math.abs(t - center) / (center + 0.01);
      const ox = nx * off;
      const oy = ny * off;
      stroke(ox, oy, 1.6 + depth * 1.8, `rgba(68, 52, 32, ${0.16 + depth * 0.2})`, wave);
      stroke(ox + nx * 1.6, oy + ny * 1.6, 1.05, `rgba(255, 246, 220, ${0.1 + depth * 0.16})`, wave * 0.6);
    }
    this.markDirty();
  }

  paintConcentric(wx: number, wz: number, radiusWorld: number, tineGap = 0.22): void {
    const c = this.worldToUv(wx, wz);
    const maxR = (radiusWorld / GARDEN.width) * TEX_W;
    const gap = (tineGap / GARDEN.width) * TEX_W;
    const ctx = this.ctx;
    ctx.lineCap = "round";
    for (let r = gap * 1.6; r < maxR; r += gap * 1.85) {
      ctx.strokeStyle = "rgba(70, 56, 34, 0.24)";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(c.u, c.v, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255, 246, 220, 0.16)";
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.arc(c.u, c.v, r + 1.8, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.markDirty();
  }

  paintWaves(seed: number): void {
    const rng = mulberry32(seed ^ 0x51ed);
    const ctx = this.ctx;
    const bands = 7 + Math.floor(rng() * 4);
    ctx.lineCap = "round";
    for (let i = 0; i < bands; i++) {
      const y0 = (rng() * 0.7 + 0.12) * TEX_H;
      const amp = 8 + rng() * 18;
      const freq = 0.008 + rng() * 0.01;
      const phase = rng() * Math.PI * 2;
      ctx.strokeStyle = "rgba(68, 54, 32, 0.18)";
      ctx.lineWidth = 2.1;
      ctx.beginPath();
      for (let x = 20; x < TEX_W - 20; x += 4) {
        const y = y0 + Math.sin(x * freq + phase) * amp;
        if (x === 20) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    this.markDirty();
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
