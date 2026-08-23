import { dist2, mulberry32, randRange, randInt } from "./rng";
import { GARDEN, type BasinState, type BonsaiState, type GeneratedWorld, type LanternState, type MossState, type StoneState } from "./types";

interface Point {
  x: number;
  z: number;
}

export function generateWorld(seed: number): GeneratedWorld {
  const rng = mulberry32(seed);

  const basin: BasinState = {
    x: randRange(rng, -3.6, -1.2) * (rng() > 0.5 ? 1 : -1),
    z: randRange(rng, -2.4, 2.6),
    rotY: rng() * Math.PI * 2,
  };

  const bonsai: BonsaiState = {
    x: 0,
    z: 0,
    rotY: rng() * Math.PI * 2,
    pruned: [],
    lastWatered: Date.now(),
    wateredCount: 1,
  };

  const occupied: { p: Point; r: number }[] = [{ p: { x: basin.x, z: basin.z }, r: 1.15 }];
  const bonsaiPos = place(rng, occupied, 1.35, 1.6);
  bonsai.x = bonsaiPos.x;
  bonsai.z = bonsaiPos.z;
  occupied.push({ p: bonsaiPos, r: 1.05 });

  const lanternCount = rng() > 0.35 ? 2 : 1;
  const lanterns: LanternState[] = [];
  for (let i = 0; i < lanternCount; i++) {
    const p = place(rng, occupied, 0.7, 1.35);
    lanterns.push({
      id: `lantern-${i}`,
      x: p.x,
      z: p.z,
      rotY: rng() * Math.PI * 2,
    });
    occupied.push({ p, r: 0.55 });
  }

  const stoneCount = randInt(rng, 5, 9);
  const stones: StoneState[] = [];
  for (let i = 0; i < stoneCount; i++) {
    const p = place(rng, occupied, 0.85, 1.15);
    const scale = randRange(rng, 0.55, 1.25);
    stones.push({
      id: `s${i}`,
      x: p.x,
      z: p.z,
      rotY: rng() * Math.PI * 2,
      scale,
      variant: randInt(rng, 0, 11),
    });
    occupied.push({ p, r: 0.45 + scale * 0.28 });
  }

  const moss: MossState[] = [];
  let mi = 0;
  for (const stone of stones) {
    if (rng() > 0.62) continue;
    const angle = rng() * Math.PI * 2;
    const dist = 0.45 + stone.scale * 0.25;
    moss.push({
      id: `m${mi++}`,
      x: stone.x + Math.cos(angle) * dist,
      z: stone.z + Math.sin(angle) * dist,
      rotY: rng() * Math.PI * 2,
      scale: randRange(rng, 0.55, 1.05),
    });
  }
  if (rng() > 0.35) {
    moss.push({
      id: `m${mi++}`,
      x: basin.x + randRange(rng, -0.9, 0.9),
      z: basin.z + randRange(rng, 0.7, 1.3),
      rotY: rng() * Math.PI * 2,
      scale: randRange(rng, 0.7, 1.2),
    });
  }

  return { seed, stones, moss, basin, bonsai, lanterns };
}

export function nextStoneId(stones: StoneState[]): string {
  let max = -1;
  for (const s of stones) {
    const n = Number(s.id.replace(/\D/g, ""));
    if (!Number.isNaN(n)) max = Math.max(max, n);
  }
  return `s${max + 1}`;
}

export function inBounds(x: number, z: number, margin = 0.85): boolean {
  return Math.abs(x) <= GARDEN.width / 2 - margin && Math.abs(z) <= GARDEN.depth / 2 - margin;
}

function place(
  rng: () => number,
  occupied: { p: Point; r: number }[],
  radius: number,
  margin: number,
): Point {
  for (let i = 0; i < 50; i++) {
    const p = {
      x: randRange(rng, -GARDEN.width / 2 + margin, GARDEN.width / 2 - margin),
      z: randRange(rng, -GARDEN.depth / 2 + margin, GARDEN.depth / 2 - margin),
    };
    if (occupied.every((o) => dist2(p.x, p.z, o.p.x, o.p.z) >= (o.r + radius) ** 2)) {
      return p;
    }
  }
  return {
    x: randRange(rng, -2, 2),
    z: randRange(rng, -2, 2),
  };
}
