import { dist2, mulberry32, randRange, randInt } from "./rng";
import { GARDEN, type BasinState, type BonsaiState, type GeneratedWorld, type LanternState, type MossState, type StoneState } from "./types";

interface Point {
  x: number;
  z: number;
}

interface ClusterPlan {
  count: number;
  x: number;
  z: number;
  scale: number;
  variants: number[];
}

const CLUSTER_OFFSETS: Record<number, Array<[number, number]>> = {
  1: [[0, 0]],
  3: [
    [0, 0],
    [0.78, 0.2],
    [-0.5, 0.64],
  ],
  5: [
    [0, 0],
    [0.82, 0.12],
    [-0.55, 0.58],
    [0.28, -0.72],
    [-0.78, -0.38],
  ],
};

export function generateWorld(seed: number): GeneratedWorld {
  const rng = mulberry32(seed);

  const bonsai: BonsaiState = {
    x: randRange(rng, 4.6, 5.4),
    z: randRange(rng, 2.15, 2.55),
    rotY: rng() * Math.PI * 2,
    pruned: [],
    lastWatered: Date.now(),
    wateredCount: 1,
  };

  const basin: BasinState = {
    x: randRange(rng, -5.5, -4.7),
    z: randRange(rng, 2.05, 2.5),
    rotY: rng() * Math.PI * 2,
  };

  const lanterns: LanternState[] = [
    {
      id: "lantern-0",
      x: randRange(rng, 5.4, 5.9),
      z: randRange(rng, -3.15, -2.7),
      rotY: rng() * Math.PI * 2,
    },
  ];

  const occupied: { p: Point; r: number }[] = [
    { p: { x: bonsai.x, z: bonsai.z }, r: 1.05 },
    { p: { x: basin.x, z: basin.z }, r: 0.85 },
    { p: { x: lanterns[0].x, z: lanterns[0].z }, r: 0.5 },
  ];

  const stones = placeIshiGumi(rng, occupied);
  const moss = mossIslands(rng, stones);

  return { seed, stones, moss, basin, bonsai, lanterns };
}

function placeIshiGumi(rng: () => number, occupied: { p: Point; r: number }[]): StoneState[] {
  const stones: StoneState[] = [];
  let nextId = 0;
  let clusterId = 0;

  const plans: ClusterPlan[] = [
    { count: 5, x: -4.7, z: -1.55, scale: 0.92, variants: [1, 0, 4, 2, 3] },
    { count: 3, x: -1.55, z: -2.45, scale: 0.8, variants: [4, 2, 0] },
    { count: 3, x: 0.85, z: -0.28, scale: 0.88, variants: [1, 3, 2] },
    { count: 3, x: 3.35, z: -2.25, scale: 0.76, variants: [4, 0, 2] },
    { count: 1, x: 5.05, z: 0.85, scale: 0.64, variants: [1] },
  ];

  for (const plan of plans) {
    const origin = {
      x: plan.x + randRange(rng, -0.22, 0.22),
      z: plan.z + randRange(rng, -0.16, 0.16),
    };
    if (!fits(origin, 1.15 + plan.count * 0.18, occupied)) {
      const fallback = place(rng, occupied, 1.1 + plan.count * 0.16, 1.35);
      origin.x = fallback.x;
      origin.z = fallback.z;
    }
    occupied.push({ p: { ...origin }, r: 1.05 + plan.count * 0.16 });

    const heading = randRange(rng, -0.35, 0.35);
    const cos = Math.cos(heading);
    const sin = Math.sin(heading);
    const offsets = CLUSTER_OFFSETS[plan.count] ?? CLUSTER_OFFSETS[1];
    const spread = 0.92 + plan.scale * 0.08;

    for (let i = 0; i < plan.count; i++) {
      const [ox, oz] = offsets[i] ?? [0, 0];
      const rx = (ox * cos - oz * sin) * spread;
      const rz = (ox * sin + oz * cos) * spread;
      const scale = i === 0 ? plan.scale : plan.scale * randRange(rng, 0.5, 0.7);
      stones.push({
        id: `s${nextId++}`,
        x: origin.x + rx,
        z: origin.z + rz,
        rotY: rng() * Math.PI * 2,
        tiltX: randRange(rng, -0.14, 0.12),
        tiltZ: randRange(rng, -0.12, 0.12),
        scale,
        variant: plan.variants[i] ?? randInt(rng, 0, 11),
        cluster: clusterId,
      });
    }
    clusterId += 1;
  }

  return stones;
}

function mossIslands(rng: () => number, stones: StoneState[]): MossState[] {
  const byCluster = new Map<number, StoneState[]>();
  for (const stone of stones) {
    if (stone.cluster == null) continue;
    const list = byCluster.get(stone.cluster) ?? [];
    list.push(stone);
    byCluster.set(stone.cluster, list);
  }

  const moss: MossState[] = [];
  for (const [id, members] of byCluster) {
    const x = members.reduce((s, m) => s + m.x, 0) / members.length;
    const z = members.reduce((s, m) => s + m.z, 0) / members.length;
    let reach = 0;
    for (const m of members) reach = Math.max(reach, Math.hypot(m.x - x, m.z - z) + m.scale * 0.28);
    moss.push({
      id: `island-${id}`,
      x: x + randRange(rng, -0.04, 0.04),
      z: z + randRange(rng, -0.04, 0.04),
      rotY: rng() * Math.PI * 2,
      scale: Math.max(0.95, reach * 1.55 + 0.35),
    });
  }
  return moss;
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

function fits(p: Point, radius: number, occupied: { p: Point; r: number }[]): boolean {
  return occupied.every((o) => dist2(p.x, p.z, o.p.x, o.p.z) >= (o.r + radius) ** 2);
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
    if (fits(p, radius, occupied)) return p;
  }
  return {
    x: randRange(rng, -2, 2),
    z: randRange(rng, -2, 2),
  };
}
