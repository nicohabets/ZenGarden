import * as THREE from "three";
import { mulberry32 } from "./rng";
import { GARDEN, type StoneState } from "./types";

const STONE_COLORS = [0x6b6560, 0x7a7268, 0x5c5854, 0x8a8074, 0x4e4b48, 0x71685c, 0x55514d];

type Shape = "slab" | "standing" | "pebble" | "angular" | "boulder";

function shapeOf(variant: number): Shape {
  const names: Shape[] = ["slab", "standing", "pebble", "angular", "boulder"];
  return names[Math.abs(variant) % names.length];
}

function deform(geo: THREE.BufferGeometry, variant: number, flattenY: number): THREE.BufferGeometry {
  const rng = mulberry32((variant + 1) * 9973);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    n.copy(v).normalize();
    const noise =
      0.16 * (rng() - 0.5) +
      0.09 * Math.sin(v.x * 3.4 + variant) +
      0.05 * Math.cos(v.z * 4.1 + variant * 0.7);
    v.addScaledVector(n, noise);
    v.y *= flattenY;
    if (v.y < -0.42) v.y = -0.42 - rng() * 0.04;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

export function createStoneGeometry(variant: number): THREE.BufferGeometry {
  const shape = shapeOf(variant);
  if (shape === "slab") return deform(new THREE.BoxGeometry(1.2, 0.38, 0.85, 2, 1, 2), variant, 1);
  if (shape === "standing") return deform(new THREE.IcosahedronGeometry(0.7, 1), variant, 1.45);
  if (shape === "pebble") return deform(new THREE.SphereGeometry(0.72, 10, 8), variant, 0.7);
  if (shape === "angular") return deform(new THREE.OctahedronGeometry(0.85, 0), variant, 0.88);
  return deform(new THREE.IcosahedronGeometry(1, 2), variant, variant % 3 === 0 ? 0.62 : 0.82);
}

export function createStoneMesh(state: StoneState): THREE.Mesh {
  const geo = createStoneGeometry(state.variant);
  const mat = new THREE.MeshStandardMaterial({
    color: STONE_COLORS[state.variant % STONE_COLORS.length],
    roughness: 0.9,
    metalness: 0.04,
    flatShading: shapeOf(state.variant) !== "pebble",
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.kind = "stone";
  mesh.userData.id = state.id;
  mesh.userData.shape = shapeOf(state.variant);
  applyStoneTransform(mesh, state);
  return mesh;
}

export function applyStoneTransform(mesh: THREE.Mesh, state: StoneState): void {
  const shape = shapeOf(state.variant);
  const h =
    shape === "standing" ? 0.42 + state.scale * 0.42 : shape === "slab" ? 0.16 + state.scale * 0.14 : 0.22 + state.scale * 0.28;
  mesh.position.set(state.x, GARDEN.sandY + h * 0.38, state.z);
  mesh.rotation.set(shape === "slab" ? 0.02 : 0.08, state.rotY, 0.03);
  const sx = shape === "slab" ? state.scale * 0.95 : state.scale * 0.72;
  const sz = shape === "standing" ? state.scale * 0.42 : state.scale * 0.62;
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

  private clear(): void {
    for (const mesh of this.meshes.values()) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat.dispose();
    }
    this.meshes.clear();
    this.stones = [];
  }
}
