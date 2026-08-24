import * as THREE from "three";
import { isMobileGarden, wantHighQuality } from "./device";
import type { SandField } from "./sand";
import { GARDEN, type Blocker } from "./types";

/** Visible grit sitting on the mass field. Budget keeps a 60fps mobile path. */
export function grainBudget(): number {
  if (wantHighQuality()) return 260_000;
  if (isMobileGarden()) return 82_000;
  return 168_000;
}

const _ndc = [
  new THREE.Vector2(-1, -1),
  new THREE.Vector2(1, -1),
  new THREE.Vector2(-1, 1),
  new THREE.Vector2(1, 1),
];
const _hit = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -GARDEN.sandY);

/**
 * Packed millimetre grit as point sprites. The height field is mass only;
 * these grains are the sand you see. World size and spacing follow the
 * visible ground patch so close-up is fine grit and orbit is still a
 * grain field, not a mesh with confetti on top.
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

  constructor(field: THREE.DataTexture) {
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
        uField: { value: field },
        uGarden: { value: new THREE.Vector2(GARDEN.width, GARDEN.depth) },
        uScale: { value: 0 },
        uBias: { value: 0 },
        uSandY: { value: GARDEN.sandY },
        uPointPx: { value: 4 },
      },
      vertexShader: GRAIN_VERT,
      fragmentShader: GRAIN_FRAG,
      depthTest: true,
      depthWrite: true,
      transparent: false,
      toneMapped: true,
    });
    this.material.forceSinglePass = true;

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.matrixAutoUpdate = false;
    this.points.userData.kind = "sand-grains";
  }

  getCount(): number {
    return this.count;
  }

  setDisplacement(scale: number, bias: number): void {
    this.material.uniforms.uScale.value = scale;
    this.material.uniforms.uBias.value = bias;
  }

  sync(
    camera: THREE.Camera,
    sand: SandField,
    blockers: Blocker[],
    zoom: number,
    viewH: number,
    targetX: number,
    targetZ: number,
    aspect: number,
    force = false,
  ): void {
    const key = layoutKey(camera, zoom, viewH, blockers.length);
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    this.layout(camera, sand, blockers, zoom, viewH, targetX, targetZ, aspect);
  }

  private layout(
    camera: THREE.Camera,
    sand: SandField,
    blockers: Blocker[],
    zoom: number,
    viewH: number,
    targetX: number,
    targetZ: number,
    aspect: number,
  ): void {
    const bounds = groundBounds(camera) ?? {
      x0: targetX - zoom * aspect * 0.7,
      x1: targetX + zoom * aspect * 0.7,
      z0: targetZ - zoom * 0.7,
      z1: targetZ + zoom * 0.7,
    };
    const pad = Math.max(0.08, zoom * 0.06);
    const x0 = Math.max(-GARDEN.width / 2 + 0.04, bounds.x0 - pad);
    const x1 = Math.min(GARDEN.width / 2 - 0.04, bounds.x1 + pad);
    const z0 = Math.max(-GARDEN.depth / 2 + 0.04, bounds.z0 - pad);
    const z1 = Math.min(GARDEN.depth / 2 - 0.04, bounds.z1 + pad);
    const spanX = Math.max(0.12, x1 - x0);
    const spanZ = Math.max(0.12, z1 - z0);
    const area = spanX * spanZ;
    const surfaceBudget = Math.floor(this.maxCount * 0.74);
    const spacing = Math.max(0.00145, Math.sqrt(area / Math.max(8, surfaceBudget)));
    const worldSize = spacing * 1.42;
    const pixel = (worldSize * viewH) / Math.max(0.2, zoom);
    this.material.uniforms.uPointPx.value = THREE.MathUtils.clamp(pixel, 2.2, 9.5);

    const hex = spacing * 0.86602540378;
    let n = 0;
    const pos = this.positions;
    const seeds = this.seeds;
    const layers = this.layers;
    const max = this.maxCount;
    let row = 0;
    for (let z = z0; z <= z1 && n < surfaceBudget; z += hex, row++) {
      const xShift = row & 1 ? spacing * 0.5 : 0;
      for (let x = x0 + xShift; x <= x1 && n < surfaceBudget; x += spacing) {
        const jx = hash2(row * 13 + 3, ((x - x0) / spacing) | 0) - 0.5;
        const jz = hash2(row * 29 + 7, ((x - x0) / spacing + 11) | 0) - 0.5;
        const gx = x + jx * spacing * 0.38;
        const gz = z + jz * spacing * 0.38;
        if (gx < x0 || gx > x1 || gz < z0 || gz > z1) continue;
        if (blocked(gx, gz, blockers)) continue;
        const seed = hash2(row * 17 + 4, n * 3 + 9);
        pos[n * 3] = gx;
        pos[n * 3 + 1] = 0;
        pos[n * 3 + 2] = gz;
        seeds[n] = seed;
        layers[n] = 0;
        n += 1;
      }
    }

    const surface = n;
    const pileBudget = Math.min(max - n, Math.floor(this.maxCount * 0.26));
    const step = Math.max(1, Math.floor(surface / Math.max(1, pileBudget)));
    for (let i = 0; i < surface && n < max && n - surface < pileBudget; i += step) {
      const gx = pos[i * 3];
      const gz = pos[i * 3 + 2];
      if (sand.sampleHeight(gx, gz) < 0.004) continue;
      pos[n * 3] = gx + (seeds[i] - 0.5) * spacing * 0.22;
      pos[n * 3 + 1] = 0;
      pos[n * 3 + 2] = gz + (hash2(i + 5, 41) - 0.5) * spacing * 0.22;
      seeds[n] = hash2(i + 19, 23);
      layers[n] = 1;
      n += 1;
    }

    this.count = n;
    const posAttr = this.geometry.getAttribute("position") as THREE.BufferAttribute;
    const seedAttr = this.geometry.getAttribute("aSeed") as THREE.BufferAttribute;
    const layerAttr = this.geometry.getAttribute("aLayer") as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    seedAttr.needsUpdate = true;
    layerAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, n);
    this.geometry.computeBoundingSphere();
  }
}

function layoutKey(camera: THREE.Camera, zoom: number, viewH: number, blockerN: number): string {
  const p = camera.position;
  return `${zoom.toFixed(3)}:${p.x.toFixed(2)}:${p.y.toFixed(2)}:${p.z.toFixed(2)}:${viewH | 0}:${blockerN}`;
}

function groundBounds(camera: THREE.Camera): { x0: number; z0: number; x1: number; z1: number } | null {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  let hits = 0;
  for (const ndc of _ndc) {
    _ray.setFromCamera(ndc, camera);
    if (_ray.ray.intersectPlane(_plane, _hit)) {
      x0 = Math.min(x0, _hit.x);
      z0 = Math.min(z0, _hit.z);
      x1 = Math.max(x1, _hit.x);
      z1 = Math.max(z1, _hit.z);
      hits += 1;
    }
  }
  if (hits < 3) return null;
  return { x0, z0, x1, z1 };
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
  uniform sampler2D uField;
  uniform vec2 uGarden;
  uniform float uScale;
  uniform float uBias;
  uniform float uSandY;
  uniform float uPointPx;
  attribute float aSeed;
  attribute float aLayer;
  varying float vSeed;
  varying float vShade;

  void main() {
    vSeed = aSeed;
    vec2 uv = vec2(position.x / uGarden.x + 0.5, 0.5 - position.z / uGarden.y);
    float t = texture2D(uField, uv).r;
    float h = t * uScale + uBias;
    float lift = (aSeed - 0.5) * 0.0024 + aLayer * (0.0028 + aSeed * 0.0016);
    vec3 world = vec3(position.x, uSandY + h + lift + 0.0011, position.z);
    if (aLayer > 0.5 && t < 0.54) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      gl_PointSize = 0.0;
      vShade = 0.0;
      return;
    }
    float crest = smoothstep(0.42, 0.72, t);
    float trough = smoothstep(0.52, 0.28, t);
    vShade = 0.78 + aSeed * 0.16 + crest * 0.12 - trough * 0.16;
    vec4 mv = modelViewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uPointPx * mix(0.86, 1.12, aSeed);
  }
`;

const GRAIN_FRAG = /* glsl */ `
  varying float vSeed;
  varying float vShade;

  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float a = atan(p.y, p.x);
    float r = length(p);
    float edge = 0.80
      + 0.14 * sin(a * 2.0 + vSeed * 6.2831)
      + 0.06 * sin(a * 5.0 + vSeed * 11.0)
      + 0.035 * sin(a * 8.0 + vSeed * 3.7);
    if (r > edge) discard;
    float core = smoothstep(edge, edge * 0.28, r);
    vec3 pale = vec3(0.86, 0.82, 0.75);
    vec3 midc = vec3(0.74, 0.71, 0.65);
    vec3 col = mix(midc, pale, fract(vSeed * 17.3));
    col *= vShade;
    col *= 0.80 + 0.22 * core;
    gl_FragColor = vec4(col, 1.0);
  }
`;
