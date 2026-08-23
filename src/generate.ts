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
  const bonsaiPos = place(rng, occupied, 1.7, 2.2);
  bonsai.x = bonsaiPos.x;
  bonsai.z = bonsaiPos.z;
  occupied.push({ p: bonsaiPos, r: 1.4 });

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

  const stones = placeIshiGumi(rng, occupied);

  const moss: MossState[] = [];
  let mi = 0;
  for (const stone of stones) {
    if (rng() > 0.55) continue;
    const angle = rng() * Math.PI * 2;
    const dist = 0.4 + stone.scale * 0.22;
    moss.push({
      id: `m${mi++}`,
      x: stone.x + Math.cos(angle) * dist,
      z: stone.z + Math.sin(angle) * dist,
      rotY: rng() * Math.PI * 2,
      scale: randRange(rng, 0.5, 0.95),
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

function placeIshiGumi(rng: () => number, occupied: { p: Point; r: number }[]): StoneState[] {
  const stones: StoneState[] = [];
  let nextId = 0;
  let clusterId = 0;

  const addCluster = (count: number, mainScale: number, preferred: number[]) => {
    const spread = 0.85 + mainScale * 0.35;
    const origin = place(rng, occupied, 0.85 + spread, 1.3);
    occupied.push({ p: origin, r: 0.7 + spread });
    const heading = rng() * Math.PI * 2;
    const id = clusterId++;
    const angles = [0, 0.55, -1.15, 2.3];

    for (let i = 0; i < count; i++) {
      const scale = i === 0 ? mainScale : mainScale * randRange(rng, 0.48, 0.72);
      const dist = i === 0 ? 0 : 0.72 + scale * 0.28 + mainScale * 0.12;
      const angle = heading + angles[i] + randRange(rng, -0.08, 0.08);
      const variant = preferred[i] ?? randInt(rng, 0, 11);
      stones.push({
        id: `s${nextId++}`,
        x: origin.x + Math.cos(angle) * dist,
        z: origin.z + Math.sin(angle) * dist,
        rotY: rng() * Math.PI * 2,
        tiltX: randRange(rng, -0.12, 0.1),
        tiltZ: randRange(rng, -0.1, 0.1),
        scale,
        variant,
        cluster: id,
      });
    }
  };

  addCluster(3, randRange(rng, 1.08, 1.32), [1, 0, 2]);
  if (rng() > 0.4) addCluster(3, randRange(rng, 0.82, 1.05), [4, 3, 2]);
  else addCluster(2, randRange(rng, 0.78, 1.0), [4, 2]);
  if (rng() > 0.42) addCluster(1, randRange(rng, 0.55, 0.85), [2]);

  return stones;
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
