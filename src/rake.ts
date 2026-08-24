export type RakeMode = "pending" | "circle" | "straight" | "curve";

export interface RakeIsland {
  x: number;
  z: number;
  innerR: number;
  outerR: number;
}

interface Point {
  x: number;
  z: number;
}

export type RakePiece =
  | { kind: "segment"; from: Point; to: Point }
  | { kind: "arc"; cx: number; cz: number; radius: number; a0: number; a1: number };

export const RING_GAP = 0.165;

export function snapRingRadius(radius: number, innerR: number): number {
  const min = innerR + RING_GAP * 0.9;
  const snapped = Math.round(radius / RING_GAP) * RING_GAP;
  return Math.max(min, snapped);
}

export class RakeGuide {
  mode: RakeMode = "pending";
  private samples: Point[] = [];
  private last: Point | null = null;
  private smooth: Point | null = null;

  private island: RakeIsland | null = null;
  private radius = 0;
  private angle = 0;

  private origin: Point = { x: 0, z: 0 };
  private dir: Point = { x: 1, z: 0 };

  begin(x: number, z: number): void {
    const p = { x, z };
    this.samples = [p];
    this.last = p;
    this.smooth = p;
    this.mode = "pending";
    this.island = null;
  }

  reset(): void {
    this.samples = [];
    this.last = null;
    this.smooth = null;
    this.mode = "pending";
    this.island = null;
  }

  feed(x: number, z: number, islands: RakeIsland[]): RakePiece | null {
    const raw = { x, z };
    this.samples.push(raw);
    if (this.mode === "pending" || this.mode === "curve") {
      this.classify(islands);
    }
    if (this.mode === "circle") return this.emitCircle(raw);
    if (this.mode === "straight") return this.emitStraight(raw);
    return this.emitCurve(raw);
  }

  private classify(islands: RakeIsland[]): void {
    const circle = this.bestCircle(islands);
    const straight = this.straightness();
    if (circle && circle.score > 0.58) {
      this.mode = "circle";
      this.island = circle.island;
      this.radius = snapRingRadius(circle.radius, circle.island.innerR);
      const last = this.samples[this.samples.length - 1];
      this.angle = Math.atan2(last.z - circle.island.z, last.x - circle.island.x);
      this.last = {
        x: circle.island.x + Math.cos(this.angle) * this.radius,
        z: circle.island.z + Math.sin(this.angle) * this.radius,
      };
      return;
    }
    const path = this.pathLength();
    if (path >= 0.85 && straight > 0.78) {
      this.mode = "straight";
      this.lockStraight();
      return;
    }
    if (path >= 0.5) this.mode = "curve";
  }

  private bestCircle(islands: RakeIsland[]): { island: RakeIsland; radius: number; score: number } | null {
    const last = this.samples[this.samples.length - 1];
    let best: { island: RakeIsland; radius: number; score: number } | null = null;
    for (const island of islands) {
      if (Math.hypot(last.x - island.x, last.z - island.z) > island.outerR + 0.15) continue;
      const radii = this.samples.map((p) => Math.hypot(p.x - island.x, p.z - island.z));
      const mean = radii.reduce((s, r) => s + r, 0) / radii.length;
      if (mean < island.innerR + 0.08 || mean > island.outerR) continue;
      const variance = radii.reduce((s, r) => s + (r - mean) ** 2, 0) / radii.length;
      const cv = Math.sqrt(variance) / Math.max(0.12, mean);
      const span = this.angularSpan(island);
      if (span < 0.32 || cv > 0.22) continue;
      const score = Math.min(1, span / 1.1) * (1 - cv / 0.22);
      if (!best || score > best.score) best = { island, radius: mean, score };
    }
    return best;
  }

  private angularSpan(island: RakeIsland): number {
    let prev = Math.atan2(this.samples[0].z - island.z, this.samples[0].x - island.x);
    let travel = 0;
    for (let i = 1; i < this.samples.length; i++) {
      const a = Math.atan2(this.samples[i].z - island.z, this.samples[i].x - island.x);
      travel += wrapAngle(a - prev);
      prev = a;
    }
    return Math.abs(travel);
  }

  private straightness(): number {
    if (this.samples.length < 3) return 0;
    const a = this.samples[0];
    const b = this.samples[this.samples.length - 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.12) return 0;
    let dev = 0;
    for (const p of this.samples) {
      const t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / (len * len);
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      dev += Math.hypot(p.x - px, p.z - pz);
    }
    const mean = dev / this.samples.length;
    return Math.max(0, 1 - mean / Math.max(0.08, len * 0.18));
  }

  private lockStraight(): void {
    const a = this.samples[0];
    const b = this.samples[this.samples.length - 1];
    let dx = b.x - a.x;
    let dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const heading = Math.atan2(dz, dx);
    const horiz = Math.abs(wrapAngle(heading)) < 0.2 || Math.abs(Math.abs(wrapAngle(heading)) - Math.PI) < 0.2;
    if (horiz) {
      this.dir = { x: dx >= 0 ? 1 : -1, z: 0 };
    } else {
      this.dir = { x: dx, z: dz };
    }
    this.origin = a;
    const t = (b.x - a.x) * this.dir.x + (b.z - a.z) * this.dir.z;
    this.last = { x: a.x + this.dir.x * t, z: a.z + this.dir.z * t };
  }

  private emitCircle(raw: Point): RakePiece | null {
    const island = this.island;
    if (!island || !this.last) return null;
    const nextAngle = Math.atan2(raw.z - island.z, raw.x - island.x);
    const delta = wrapAngle(nextAngle - this.angle);
    if (Math.abs(delta) < 0.012) return null;
    const a0 = this.angle;
    const a1 = this.angle + delta;
    this.angle = a1;
    this.last = {
      x: island.x + Math.cos(a1) * this.radius,
      z: island.z + Math.sin(a1) * this.radius,
    };
    return { kind: "arc", cx: island.x, cz: island.z, radius: this.radius, a0, a1 };
  }

  private emitStraight(raw: Point): RakePiece | null {
    if (!this.last) return null;
    const t = (raw.x - this.origin.x) * this.dir.x + (raw.z - this.origin.z) * this.dir.z;
    const next = { x: this.origin.x + this.dir.x * t, z: this.origin.z + this.dir.z * t };
    if (Math.hypot(next.x - this.last.x, next.z - this.last.z) < 0.04) return null;
    const from = this.last;
    this.last = next;
    return { kind: "segment", from, to: next };
  }

  private emitCurve(raw: Point): RakePiece | null {
    if (!this.smooth || !this.last) return null;
    const next = {
      x: this.smooth.x * 0.38 + raw.x * 0.62,
      z: this.smooth.z * 0.38 + raw.z * 0.62,
    };
    if (Math.hypot(next.x - this.last.x, next.z - this.last.z) < 0.035) return null;
    const from = this.last;
    this.smooth = next;
    this.last = next;
    return { kind: "segment", from, to: next };
  }

  private pathLength(): number {
    let len = 0;
    for (let i = 1; i < this.samples.length; i++) {
      len += Math.hypot(this.samples[i].x - this.samples[i - 1].x, this.samples[i].z - this.samples[i - 1].z);
    }
    return len;
  }
}

function wrapAngle(a: number): number {
  let d = a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
