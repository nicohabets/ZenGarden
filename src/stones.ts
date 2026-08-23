import * as THREE from "three";
import { mulberry32 } from "./rng";
import { GARDEN, type StoneState } from "./types";

type Lithology = "granite" | "basalt";
type Shape = "slab" | "standing" | "pebble" | "angular" | "boulder";

const GRANITE = [0xb4aba0, 0xc0b6aa, 0xa69d92, 0xbbb2a6, 0x9c948a];
const BASALT = [0x6e6a66, 0x5c5956, 0x78746e, 0x4f4d4a, 0x6a6662];

const geoCache = new Map<number, THREE.BufferGeometry>();
let graniteTex: THREE.CanvasTexture | null = null;
let basaltTex: THREE.CanvasTexture | null = null;
let mossMat: THREE.MeshStandardMaterial | null = null;
let lichenMat: THREE.MeshStandardMaterial | null = null;
let mossGeo: THREE.BufferGeometry | null = null;

function shapeOf(variant: number): Shape {
  const names: Shape[] = ["slab", "standing", "pebble", "angular", "boulder"];
  return names[Math.abs(variant) % names.length];
}

function lithologyOf(variant: number): Lithology {
  return variant % 2 === 0 ? "granite" : "basalt";
}

function rockTexture(kind: Lithology): THREE.CanvasTexture {
  if (kind === "granite" && graniteTex) return graniteTex;
  if (kind === "basalt" && basaltTex) return basaltTex;

  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("stone texture");

  if (kind === "granite") {
    ctx.fillStyle = "#b7aea2";
    ctx.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 180; i++) {
      const x = (i * 17) % 64;
      const y = (i * 29 + 11) % 64;
      ctx.fillStyle = i % 5 === 0 ? "#d8cfc2" : i % 3 === 0 ? "#8a8278" : "#c4bbaf";
      ctx.fillRect(x, y, 1 + (i % 2), 1);
    }
    ctx.strokeStyle = "rgba(120,112,102,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(10, 6);
    ctx.lineTo(56, 48);
    ctx.moveTo(4, 38);
    ctx.lineTo(36, 60);
    ctx.stroke();
  } else {
    ctx.fillStyle = "#6a6662";
    ctx.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 120; i++) {
      const x = (i * 13) % 64;
      const y = (i * 23 + 7) % 64;
      ctx.fillStyle = i % 4 === 0 ? "#4e4c48" : "#7a7670";
      ctx.fillRect(x, y, 2, 1);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (kind === "granite") graniteTex = tex;
  else basaltTex = tex;
  return tex;
}

function deform(geo: THREE.BufferGeometry, variant: number, flattenY: number, chips: number): THREE.BufferGeometry {
  const rng = mulberry32((variant + 1) * 9973);
  const pos = geo.attributes.position;
  const color = new THREE.Float32BufferAttribute(pos.count * 3, 3);
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const litho = lithologyOf(variant);
  const palette = litho === "granite" ? GRANITE : BASALT;
  const base = new THREE.Color(palette[variant % palette.length]);
  const fleck = new THREE.Color(litho === "granite" ? 0xe2d8cc : 0x3a3836);
  const moss = new THREE.Color(0x5a6844);

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.copy(v).normalize();
    const ridges =
      0.075 * Math.sin(v.x * 2.2 + v.z * 1.5 + variant) +
      0.045 * Math.cos(v.y * 2.8 + v.x * 1.8 + variant * 0.5);
    v.addScaledVector(n, ridges + chips * (rng() - 0.5));
    v.y *= flattenY;
    if (v.y < -0.38) v.y = -0.38;
    pos.setXYZ(i, v.x, v.y, v.z);

    const c = base.clone();
    if (rng() > 0.88) c.lerp(fleck, 0.4);
    if (v.y > 0.12 && n.y > 0.4 && rng() > 0.78) c.lerp(moss, 0.22);
    color.setXYZ(i, c.r, c.g, c.b);
  }
  geo.setAttribute("color", color);
  geo.computeVertexNormals();
  return geo;
}

export function createStoneGeometry(variant: number): THREE.BufferGeometry {
  const cached = geoCache.get(variant);
  if (cached) return cached;

  const shape = shapeOf(variant);
  let geo: THREE.BufferGeometry;
  if (shape === "slab") geo = deform(new THREE.BoxGeometry(1.35, 0.32, 0.9, 3, 2, 3), variant, 0.95, 0.08);
  else if (shape === "standing") geo = deform(new THREE.DodecahedronGeometry(0.62, 0), variant, 1.35, 0.07);
  else if (shape === "pebble") geo = deform(new THREE.SphereGeometry(0.7, 11, 8), variant, 0.58, 0.05);
  else if (shape === "angular") geo = deform(new THREE.DodecahedronGeometry(0.72, 0), variant, 0.82, 0.1);
  else geo = deform(new THREE.IcosahedronGeometry(0.88, 1), variant, variant % 3 === 0 ? 0.64 : 0.8, 0.08);

  geo.userData.shared = true;
  geoCache.set(variant, geo);
  return geo;
}

function sharedMoss(): { moss: THREE.MeshStandardMaterial; lichen: THREE.MeshStandardMaterial; geo: THREE.BufferGeometry } {
  mossMat ??= new THREE.MeshStandardMaterial({ color: 0x52643c, roughness: 0.98, flatShading: true });
  lichenMat ??= new THREE.MeshStandardMaterial({ color: 0x7c784c, roughness: 0.94, flatShading: true });
  mossGeo ??= new THREE.IcosahedronGeometry(0.16, 1);
  mossGeo.userData.shared = true;
  return { moss: mossMat, lichen: lichenMat, geo: mossGeo };
}

function addLichen(mesh: THREE.Mesh, state: StoneState): void {
  if (state.variant % 3 === 1) return;
  const rng = mulberry32((state.variant + 3) * 6151 + state.id.length * 17);
  const { moss, lichen, geo } = sharedMoss();
  const count = 1 + (state.variant % 2);
  for (let i = 0; i < count; i++) {
    const patch = new THREE.Mesh(geo, rng() > 0.4 ? moss : lichen);
    patch.position.set(rng() * 0.28 - 0.14, 0.18 + rng() * 0.1, rng() * 0.22 - 0.08);
    patch.scale.set(0.7 + rng() * 0.35, 0.18 + rng() * 0.08, 0.55 + rng() * 0.25);
    patch.rotation.set(rng() * 0.5, rng() * Math.PI, rng() * 0.4);
    patch.receiveShadow = true;
    patch.userData.kind = "stone";
    patch.userData.id = state.id;
    patch.userData.lichen = true;
    mesh.add(patch);
  }
}

export function createStoneMesh(state: StoneState): THREE.Mesh {
  const geo = createStoneGeometry(state.variant);
  const shape = shapeOf(state.variant);
  const litho = lithologyOf(state.variant);
  const tex = rockTexture(litho);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: tex,
    bumpMap: tex,
    bumpScale: litho === "granite" ? 0.07 : 0.1,
    roughness: litho === "granite" ? 0.8 : 0.9,
    metalness: litho === "granite" ? 0.06 : 0.03,
    vertexColors: true,
    flatShading: shape !== "pebble",
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.kind = "stone";
  mesh.userData.id = state.id;
  mesh.userData.shape = shape;
  mesh.userData.lithology = litho;
  addLichen(mesh, state);
  applyStoneTransform(mesh, state);
  return mesh;
}

export function applyStoneTransform(mesh: THREE.Mesh, state: StoneState): void {
  const shape = shapeOf(state.variant);
  const h =
    shape === "standing"
      ? 0.42 + state.scale * 0.32
      : shape === "slab"
        ? 0.14 + state.scale * 0.1
        : 0.22 + state.scale * 0.22;
  mesh.position.set(state.x, GARDEN.sandY + h * 0.3, state.z);
  const tiltX = state.tiltX ?? (shape === "slab" ? 0.03 : 0.06);
  const tiltZ = state.tiltZ ?? 0.02;
  mesh.rotation.set(tiltX, state.rotY, tiltZ);
  const sx = shape === "slab" ? state.scale * 1.05 : state.scale * 0.82;
  const sz = shape === "standing" ? state.scale * 0.52 : state.scale * 0.74;
  mesh.scale.set(sx, h, sz);
}

export class StoneField {
  readonly group = new THREE.Group();
  readonly meshes = new Map<string, THREE.Mesh>();
  stones: StoneState[] = [];

  load(states: StoneState[]): void {
    this.clear();
    for (const s of states) this.add(s);
  }

  add(state: StoneState): THREE.Mesh {
    this.stones.push(state);
    const mesh = createStoneMesh(state);
    this.meshes.set(state.id, mesh);
    this.group.add(mesh);
    return mesh;
  }

  move(id: string, x: number, z: number): void {
    const state = this.stones.find((s) => s.id === id);
    const mesh = this.meshes.get(id);
    if (!state || !mesh) return;
    state.x = x;
    state.z = z;
    applyStoneTransform(mesh, state);
  }

  get(id: string): StoneState | undefined {
    return this.stones.find((s) => s.id === id);
  }

  stats(): { count: number; minDist: number; scaleMin: number; scaleMax: number; tilted: number; clustered: number } {
    let minDist = Infinity;
    for (let i = 0; i < this.stones.length; i++) {
      for (let j = i + 1; j < this.stones.length; j++) {
        const d = Math.hypot(this.stones[i].x - this.stones[j].x, this.stones[i].z - this.stones[j].z);
        minDist = Math.min(minDist, d);
      }
    }
    const scales = this.stones.map((s) => s.scale);
    return {
      count: this.stones.length,
      minDist: Number.isFinite(minDist) ? minDist : 0,
      scaleMin: scales.length ? Math.min(...scales) : 0,
      scaleMax: scales.length ? Math.max(...scales) : 0,
      tilted: this.stones.filter((s) => Math.abs(s.tiltX ?? 0) + Math.abs(s.tiltZ ?? 0) > 0.02).length,
      clustered: this.stones.filter((s) => s.cluster != null).length,
    };
  }

  private clear(): void {
    for (const mesh of this.meshes.values()) {
      this.group.remove(mesh);
      if (!mesh.geometry.userData.shared) mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (!mat.userData.shared) mat.dispose();
    }
    this.meshes.clear();
    this.stones = [];
  }
}
