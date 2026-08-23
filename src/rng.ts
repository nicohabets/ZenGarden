/** Deterministic 32-bit mulberry32 generator. */
export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function randRange(rng: () => number, min: number, max: number): number {
  return min + (max - min) * rng();
}

export function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(randRange(rng, min, max + 1));
}

export function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

export function hashSeed(n: number): number {
  return (Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) >>> 0) || 1;
}

export function freshSeed(): number {
  const a = (Math.random() * 0xffffffff) >>> 0;
  const b = (Date.now() ^ ((performance.now() * 1000) | 0)) >>> 0;
  return ((a ^ b) >>> 0) || 1;
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}
