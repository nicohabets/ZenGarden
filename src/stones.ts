import * as THREE from "three";
import { mulberry32 } from "./rng";
import { GARDEN, type StoneState } from "./types";

type Lithology = "granite" | "basalt";
type Shape = "slab" | "standing" | "pebble" | "angular" | "boulder";

const GRANITE = [0xd4ccc2, 0xe0d8ce, 0xc8c0b6, 0xddd6cc, 0xbeb8ae];
const BASALT = [0x8e8a84, 0x7c7872, 0x9a968e, 0x726e68, 0x86827c];

const geoCache = new Map<number, THREE.BufferGeometry>();
let graniteTex: THREE.CanvasTexture | null = null;
let basaltTex: THREE.CanvasTexture | null = null;
let mossMat: THREE.MeshStandardMaterial | null = null;
let lichenMat: THREE.MeshStandardMaterial | null = null;
let mossGeo: THREE.BufferGeometry | null = null;
let collarGeo: THREE.BufferGeometry | null = null;

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

  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("stone texture");

  if (kind === "granite") {
    ctx.fillStyle = "#c8c0b6";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 4200; i++) {
      const x = (i * 37 + 11) % size;
      const y = (i * 53 + 19) % size;
      const tone = i % 7 === 0 ? "#8a8278" : i % 5 === 0 ? "#d8cfc4" : i % 3 === 0 ? "#c2b8ac" : "#a89f94";
      ctx.fillStyle = tone;
      ctx.fillRect(x, y, 1 + (i % 2), 1 + ((i * 3) % 2));
    }
    ctx.strokeStyle = "rgba(90,84,76,0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(18, 12);
    ctx.lineTo(210, 168);
    ctx.moveTo(8, 140);
    ctx.lineTo(120, 240);
    ctx.moveTo(160, 20);
    ctx.lineTo(248, 110);
    ctx.stroke();
    for (let i = 0; i < 80; i++) {
      ctx.fillStyle = i % 2 === 0 ? "rgba(70,66,60,0.35)" : "rgba(228,220,210,0.28)";
      ctx.fillRect((i * 41) % size, (i * 67 + 9) % size, 2, 1);
    }
  } else {
    ctx.fillStyle = "#7a7670";
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 2600; i++) {
      const x = (i * 29 + 7) % size;
      const y = (i * 47 + 13) % size;
      ctx.fillStyle = i % 4 === 0 ? "#3e3c38" : i % 3 === 0 ? "#7a746c" : "#686460";
      ctx.fillRect(x, y, 2, 1);
    }
    ctx.strokeStyle = "rgba(30,28,26,0.2)";
    ctx.beginPath();
    ctx.moveTo(20, 40);
    ctx.lineTo(200, 190);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.8, 1.8);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
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
  const fleck = new THREE.Color(litho === "granite" ? 0xf0e8dc : 0x4a4844);
  const moss = new THREE.Color(0x5a6c48);
  const stretchX = 0.88 + (variant % 5) * 0.05;
  const stretchZ = 0.9 + ((variant * 3) % 4) * 0.04;

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.copy(v).normalize();
    const ridges =
      0.045 * Math.sin(v.x * 2.2 + v.z * 1.5 + variant) +
      0.028 * Math.cos(v.y * 2.4 + v.x * 1.8 + variant * 0.5) +
      0.016 * Math.sin(v.x * 4.6 + v.z * 4.1 + variant * 1.3);
    v.addScaledVector(n, ridges + chips * (rng() - 0.5));
    v.x *= stretchX;
    v.z *= stretchZ;
    v.y *= flattenY;
    if (v.y < -0.4) v.y = -0.4;
    pos.setXYZ(i, v.x, v.y, v.z);

    const c = base.clone();
    if (rng() > 0.86) c.lerp(fleck, 0.28);
    if (v.y < -0.12 && n.y < 0.12 && rng() > 0.7) c.lerp(moss, 0.18);
    else if (v.y > 0.12 && n.y > 0.4 && rng() > 0.88) c.lerp(moss, 0.1);
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
  if (shape === "slab") geo = deform(new THREE.BoxGeometry(1.38, 0.34, 0.92, 10, 5, 8), variant, 0.94, 0.03);
  else if (shape === "standing") geo = deform(new THREE.DodecahedronGeometry(0.64, 3), variant, 1.36, 0.028);
  else if (shape === "pebble") geo = deform(new THREE.SphereGeometry(0.7, 28, 20), variant, 0.56, 0.022);
  else if (shape === "angular") geo = deform(new THREE.DodecahedronGeometry(0.74, 3), variant, 0.82, 0.034);
  else geo = deform(new THREE.IcosahedronGeometry(0.9, 3), variant, variant % 3 === 0 ? 0.64 : 0.8, 0.028);

  geo.userData.shared = true;
  geoCache.set(variant, geo);
  return geo;
}

function sharedMoss(): {
  moss: THREE.MeshStandardMaterial;
  lichen: THREE.MeshStandardMaterial;
  geo: THREE.BufferGeometry;
  collar: THREE.BufferGeometry;
} {
  mossMat ??= new THREE.MeshStandardMaterial({
    color: 0x5a7044,
    roughness: 0.96,
    metalness: 0,
    flatShading: false,
  });
  lichenMat ??= new THREE.MeshStandardMaterial({
    color: 0x7a7a50,
    roughness: 0.94,
    metalness: 0,
    flatShading: false,
  });
  mossGeo ??= new THREE.IcosahedronGeometry(0.16, 2);
  mossGeo.userData.shared = true;
  collarGeo ??= new THREE.SphereGeometry(0.42, 18, 12);
  collarGeo.userData.shared = true;
  return { moss: mossMat, lichen: lichenMat, geo: mossGeo, collar: collarGeo };
}

function addLichen(mesh: THREE.Mesh, state: StoneState): void {
  const rng = mulberry32((state.variant + 3) * 6151 + state.id.length * 17);
  const { moss, lichen, geo, collar } = sharedMoss();

  const base = new THREE.Mesh(collar, moss);
  base.position.set(0, -0.28, 0.02);
  base.scale.set(0.72 + rng() * 0.12, 0.07 + rng() * 0.03, 0.62 + rng() * 0.1);
  base.rotation.y = rng() * Math.PI;
  base.receiveShadow = true;
  base.userData.kind = "stone";
  base.userData.id = state.id;
  base.userData.mossBase = true;
  mesh.add(base);

  if (state.variant % 3 === 1) return;
  const count = 1 + (state.variant % 2);
  for (let i = 0; i < count; i++) {
    const patch = new THREE.Mesh(geo, rng() > 0.4 ? moss : lichen);
    patch.position.set(rng() * 0.26 - 0.13, 0.16 + rng() * 0.1, rng() * 0.2 - 0.08);
    patch.scale.set(0.65 + rng() * 0.3, 0.16 + rng() * 0.07, 0.5 + rng() * 0.22);
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
    bumpScale: litho === "granite" ? 0.12 : 0.16,
    roughness: litho === "granite" ? 0.86 : 0.93,
    metalness: litho === "granite" ? 0.04 : 0.02,
    vertexColors: true,
    flatShading: false,
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

export function applyStoneTransform(mesh: THREE.Mesh, state: StoneState, sandHeight = 0): void {
  const shape = shapeOf(state.variant);
  const h =
    shape === "standing"
      ? 0.4 + state.scale * 0.3
      : shape === "slab"
        ? 0.13 + state.scale * 0.09
        : 0.2 + state.scale * 0.2;
  const embed = shape === "standing" ? 0.14 : shape === "slab" ? 0.08 : 0.11;
  mesh.position.set(state.x, GARDEN.sandY + sandHeight + h * 0.18 - embed, state.z);
  const tiltX = state.tiltX ?? (shape === "slab" ? 0.03 : 0.06);
  const tiltZ = state.tiltZ ?? 0.02;
  mesh.rotation.set(tiltX, state.rotY, tiltZ);
  const sx = shape === "slab" ? state.scale * 1.02 : state.scale * 0.8;
  const sz = shape === "standing" ? state.scale * 0.5 : state.scale * 0.72;
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

  move(id: string, x: number, z: number, sandHeight = 0): void {
    const state = this.stones.find((s) => s.id === id);
    const mesh = this.meshes.get(id);
    if (!state || !mesh) return;
    state.x = x;
    state.z = z;
    applyStoneTransform(mesh, state, sandHeight);
  }

  settleToSand(sample: (x: number, z: number) => number): void {
    for (const state of this.stones) {
      const mesh = this.meshes.get(state.id);
      if (mesh) applyStoneTransform(mesh, state, sample(state.x, state.z));
    }
  }

  get(id: string): StoneState | undefined {
    return this.stones.find((s) => s.id === id);
  }

  stats(): {
    count: number;
    minDist: number;
    scaleMin: number;
    scaleMax: number;
    tilted: number;
    clustered: number;
    clusterSizes: number[];
  } {
    let minDist = Infinity;
    for (let i = 0; i < this.stones.length; i++) {
      for (let j = i + 1; j < this.stones.length; j++) {
        const d = Math.hypot(this.stones[i].x - this.stones[j].x, this.stones[i].z - this.stones[j].z);
        minDist = Math.min(minDist, d);
      }
    }
    const scales = this.stones.map((s) => s.scale);
    const sizes = new Map<number, number>();
    for (const s of this.stones) {
      if (s.cluster == null) continue;
      sizes.set(s.cluster, (sizes.get(s.cluster) ?? 0) + 1);
    }
    return {
      count: this.stones.length,
      minDist: Number.isFinite(minDist) ? minDist : 0,
      scaleMin: scales.length ? Math.min(...scales) : 0,
      scaleMax: scales.length ? Math.max(...scales) : 0,
      tilted: this.stones.filter((s) => Math.abs(s.tiltX ?? 0) + Math.abs(s.tiltZ ?? 0) > 0.02).length,
      clustered: this.stones.filter((s) => s.cluster != null).length,
      clusterSizes: [...sizes.values()].sort((a, b) => b - a),
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
