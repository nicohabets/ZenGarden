import * as THREE from "three";
import type { CameraRig } from "./camera";
import { isMobileGarden, wantHighQuality } from "./device";
import type { SandField } from "./sand";
import { GARDEN, type Blocker } from "./types";

/** Visible grit sitting on the mass field. Budget keeps a 60fps mobile path. */
export function grainBudget(): number {
  if (wantHighQuality()) return 280_000;
  if (isMobileGarden()) return 86_000;
  return 176_000;
}

/**
 * Packed millimetre grit as point sprites. The height field is mass only;
 * these grains are the sand you see. Coverage follows the slanted ground
 * patch so a low close-up does not flash the bed at the far edge.
 */
export class GrainCloud {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly seeds: Float32Array;
  private readonly layers: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly maxCount: number;
  private count = 0;
  private lastKey = "";
  private lastHeightAt = 0;

  constructor() {
    this.maxCount = grainBudget();
    this.positions = new Float32Array(this.maxCount * 3);
    this.seeds = new Float32Array(this.maxCount);
    this.layers = new Float32Array(this.maxCount);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("aSeed", new THREE.BufferAttribute(this.seeds, 1));
    this.geometry.setAttribute("aLayer", new THREE.BufferAttribute(this.layers, 1));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uPointPx: { value: 4 },
      },
      vertexShader: GRAIN_VERT,
      fragmentShader: GRAIN_FRAG,
      depthTest: true,
      depthWrite: true,
      transparent: false,
      toneMapped: true,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.matrixAutoUpdate = false;
    this.points.userData.kind = "sand-grains";
  }

  getCount(): number {
    return this.count;
  }

  sync(cam: CameraRig, sand: SandField, blockers: Blocker[], viewH: number, force = false): void {
    const key = `${cam.zoom.toFixed(3)}:${cam.target.x.toFixed(2)}:${cam.target.z.toFixed(2)}:${cam.azimuth.toFixed(2)}:${cam.elevation.toFixed(2)}:${cam.aspect.toFixed(2)}:${viewH | 0}:${blockers.length}`;
    if (force || key !== this.lastKey) {
      this.lastKey = key;
      this.layout(cam, sand, blockers, viewH);
      this.lastHeightAt = performance.now();
      return;
    }
    const now = performance.now();
    if (now - this.lastHeightAt > 140) {
      this.lift(sand);
      this.lastHeightAt = now;
    }
  }

  private layout(cam: CameraRig, sand: SandField, blockers: Blocker[], viewH: number): void {
    const bounds = slantBounds(cam);
    const x0 = Math.max(-GARDEN.width / 2 + 0.03, bounds.x0);
    const x1 = Math.min(GARDEN.width / 2 - 0.03, bounds.x1);
    const z0 = Math.max(-GARDEN.depth / 2 + 0.03, bounds.z0);
    const z1 = Math.min(GARDEN.depth / 2 - 0.03, bounds.z1);
    const spanX = Math.max(0.1, x1 - x0);
    const spanZ = Math.max(0.1, z1 - z0);
    const surfaceBudget = Math.floor(this.maxCount * 0.8);
    const spacing = Math.max(0.00135, Math.sqrt((spanX * spanZ) / Math.max(8, surfaceBudget)));
    const worldSize = spacing * 1.72;
    const pixel = (worldSize * viewH) / Math.max(0.2, cam.zoom);
    this.material.uniforms.uPointPx.value = THREE.MathUtils.clamp(pixel, 2.6, 8.8);

    const hex = spacing * 0.86602540378;
    let n = 0;
    const pos = this.positions;
    const seeds = this.seeds;
    const layers = this.layers;
    let row = 0;
    for (let z = z0; z <= z1 && n < surfaceBudget; z += hex, row++) {
      const xShift = row & 1 ? spacing * 0.5 : 0;
      for (let x = x0 + xShift; x <= x1 && n < surfaceBudget; x += spacing) {
        const col = ((x - x0) / spacing) | 0;
        const jx = hash2(row * 13 + 3, col) - 0.5;
        const jz = hash2(row * 29 + 7, col + 11) - 0.5;
        const gx = x + jx * spacing * 0.34;
        const gz = z + jz * spacing * 0.34;
        if (gx < x0 || gx > x1 || gz < z0 || gz > z1) continue;
        if (blocked(gx, gz, blockers)) continue;
        const seed = hash2(row * 17 + 4, n * 3 + 9);
        const h = sand.sampleHeight(gx, gz);
        pos[n * 3] = gx;
        pos[n * 3 + 1] = liftY(h, seed, 0);
        pos[n * 3 + 2] = gz;
        seeds[n] = seed;
        layers[n] = 0;
        n += 1;
      }
    }

    const surface = n;
    const pileBudget = Math.min(this.maxCount - n, Math.floor(this.maxCount * 0.2));
    const step = Math.max(1, Math.floor(surface / Math.max(1, pileBudget)));
    for (let i = 0; i < surface && n < this.maxCount && n - surface < pileBudget; i += step) {
      const gx = pos[i * 3];
      const gz = pos[i * 3 + 2];
      const h = sand.sampleHeight(gx, gz);
      if (h < 0.006) continue;
      const seed = hash2(i + 19, 23);
      const ox = gx + (seeds[i] - 0.5) * spacing * 0.28;
      const oz = gz + (hash2(i + 5, 41) - 0.5) * spacing * 0.28;
      pos[n * 3] = ox;
      pos[n * 3 + 1] = liftY(h, seed, 1);
      pos[n * 3 + 2] = oz;
      seeds[n] = seed;
      layers[n] = 1;
      n += 1;
    }

    this.count = n;
    (this.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute("aSeed") as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute("aLayer") as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.setDrawRange(0, n);
    this.geometry.computeBoundingSphere();
  }

  private lift(sand: SandField): void {
    const pos = this.positions;
    const seeds = this.seeds;
    const layers = this.layers;
    const n = this.count;
    for (let i = 0; i < n; i++) {
      const h = sand.sampleHeight(pos[i * 3], pos[i * 3 + 2]);
      pos[i * 3 + 1] = liftY(h, seeds[i], layers[i]);
    }
    (this.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }
}

function liftY(height: number, seed: number, layer: number): number {
  return GARDEN.sandY + height * 0.92 + (seed - 0.5) * 0.0026 + layer * (0.0031 + seed * 0.0018);
}

function slantBounds(cam: CameraRig): { x0: number; z0: number; x1: number; z1: number } {
  const sinE = Math.max(0.2, Math.sin(cam.elevation));
  const halfAlong = (cam.zoom * 0.62) / sinE;
  const halfAcross = cam.zoom * cam.aspect * 0.62;
  const sin = Math.sin(cam.azimuth);
  const cos = Math.cos(cam.azimuth);
  const corners = [
    [-halfAcross, -halfAlong],
    [halfAcross, -halfAlong],
    [-halfAcross, halfAlong],
    [halfAcross, halfAlong],
  ] as const;
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const [across, along] of corners) {
    const x = cam.target.x + across * cos + along * sin;
    const z = cam.target.z - across * sin + along * cos;
    x0 = Math.min(x0, x);
    z0 = Math.min(z0, z);
    x1 = Math.max(x1, x);
    z1 = Math.max(z1, z);
  }
  const pad = Math.max(0.1, cam.zoom * 0.08);
  return { x0: x0 - pad, z0: z0 - pad, x1: x1 + pad, z1: z1 + pad };
}

function blocked(x: number, z: number, blockers: Blocker[]): boolean {
  for (const b of blockers) {
    const dx = x - b.x;
    const dz = z - b.z;
    if (dx * dx + dz * dz < b.r * b.r * 0.84) return true;
  }
  return false;
}

function hash2(x: number, y: number): number {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

const GRAIN_VERT = /* glsl */ `
  uniform float uPointPx;
  attribute float aSeed;
  attribute float aLayer;
  varying float vSeed;
  varying float vShade;

  void main() {
    vSeed = aSeed;
    float crest = clamp((position.y - 0.02) * 9.0, -0.35, 0.45);
    vShade = 0.80 + aSeed * 0.14 + crest * 0.22 + aLayer * 0.04;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uPointPx * mix(0.84, 1.16, aSeed);
  }
`;

const GRAIN_FRAG = /* glsl */ `
  varying float vSeed;
  varying float vShade;

  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float a = atan(p.y, p.x);
    float wobble = 0.18 * sin(a * 2.0 + vSeed * 6.2831)
      + 0.07 * sin(a * 5.0 + vSeed * 9.4)
      + 0.04 * sin(a * 9.0 + vSeed * 2.2);
    vec2 q = vec2(p.x * mix(0.92, 1.18, fract(vSeed * 5.1)), p.y * mix(0.88, 1.14, fract(vSeed * 8.7)));
    float d = length(q);
    if (d > 0.78 + wobble) discard;
    float core = smoothstep(0.78 + wobble, 0.18, d);
    vec3 pale = vec3(0.88, 0.84, 0.77);
    vec3 midc = vec3(0.70, 0.67, 0.60);
    vec3 col = mix(midc, pale, fract(vSeed * 17.3));
    col *= vShade * (0.78 + 0.24 * core);
    gl_FragColor = vec4(col, 1.0);
  }
`;
