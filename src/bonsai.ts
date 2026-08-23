import * as THREE from "three";
import { mulberry32, randRange } from "./rng";
import { GARDEN, type BonsaiState } from "./types";

const FOLIAGE_BASE = [0x4f5d3e, 0x5b6844, 0x3f4c32, 0x6a734c];

export class Bonsai {
  readonly group = new THREE.Group();
  readonly pickables: THREE.Object3D[] = [];
  readonly foliage = new Map<string, THREE.Mesh>();
  private soil!: THREE.MeshStandardMaterial;
  private wetUntil = 0;
  private droplets: THREE.Mesh[] = [];

  constructor(
    readonly seed: number,
    state: BonsaiState,
  ) {
    this.group.userData.kind = "bonsai";
    this.build(state);
    this.setPose(state.x, state.z, state.rotY);
    for (const id of state.pruned) this.removeFoliage(id);
    this.applyWaterLook(state);
  }

  setPose(x: number, z: number, rotY: number): void {
    this.group.position.set(x, GARDEN.sandY, z);
    this.group.rotation.y = rotY;
  }

  prune(id: string): boolean {
    if (!this.foliage.has(id)) return false;
    if (this.foliage.size <= 2) return false;
    this.removeFoliage(id);
    return true;
  }

  water(state: BonsaiState): void {
    state.wateredCount += 1;
    state.lastWatered = Date.now();
    this.wetUntil = performance.now() + 4200;
    this.soil.color.setHex(0x2a2218);
    this.spawnDroplets();
    this.applyWaterLook(state);
  }

  update(now: number): void {
    if (this.wetUntil && now > this.wetUntil) {
      this.soil.color.setHex(0x3b3226);
      this.wetUntil = 0;
    }
    for (let i = this.droplets.length - 1; i >= 0; i--) {
      const d = this.droplets[i];
      d.position.y -= 0.018;
      d.scale.multiplyScalar(0.96);
      if (d.position.y < 0.12) {
        this.group.remove(d);
        d.geometry.dispose();
        (d.material as THREE.Material).dispose();
        this.droplets.splice(i, 1);
      }
    }
  }

  private build(state: BonsaiState): void {
    const rng = mulberry32(this.seed ^ 0xb0a51);

    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.36, 0.28, 20),
      new THREE.MeshStandardMaterial({
        color: 0x6d3a32,
        roughness: 0.45,
        metalness: 0.08,
      }),
    );
    pot.position.y = 0.16;
    pot.castShadow = true;
    pot.receiveShadow = true;
    pot.userData.kind = "bonsai";
    this.group.add(pot);
    this.pickables.push(pot);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.035, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0x5a2f2a, roughness: 0.5 }),
    );
    rim.position.y = 0.3;
    rim.rotation.x = Math.PI / 2;
    rim.userData.kind = "bonsai";
    this.group.add(rim);
    this.pickables.push(rim);

    this.soil = new THREE.MeshStandardMaterial({
      color: 0x3b3226,
      roughness: 1,
    });
    const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.05, 16), this.soil);
    soil.position.y = 0.3;
    soil.userData.kind = "bonsai";
    this.group.add(soil);
    this.pickables.push(soil);

    const trunkPts: THREE.Vector3[] = [];
    let x = 0;
    let z = 0;
    for (let i = 0; i < 7; i++) {
      const y = 0.3 + i * 0.18;
      x += randRange(rng, -0.07, 0.08);
      z += randRange(rng, -0.05, 0.05);
      trunkPts.push(new THREE.Vector3(x, y, z));
    }
    const trunk = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(trunkPts), 20, 0.055, 8, false),
      new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.86 }),
    );
    trunk.castShadow = true;
    trunk.userData.kind = "bonsai";
    this.group.add(trunk);
    this.pickables.push(trunk);

    const branchCount = 4 + Math.floor(rng() * 3);
    let foliageIndex = 0;
    for (let b = 0; b < branchCount; b++) {
      const t = 0.35 + rng() * 0.55;
      const origin = trunkPts[Math.min(trunkPts.length - 1, Math.floor(t * (trunkPts.length - 1)))];
      const dir = new THREE.Vector3(randRange(rng, -1, 1), randRange(rng, 0.2, 0.8), randRange(rng, -1, 1)).normalize();
      const length = randRange(rng, 0.28, 0.55);
      const end = origin.clone().addScaledVector(dir, length);
      const branch = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3([origin, end]), 8, 0.018, 6, false),
        new THREE.MeshStandardMaterial({ color: 0x3d2c20, roughness: 0.9 }),
      );
      branch.castShadow = true;
      branch.userData.kind = "bonsai";
      this.group.add(branch);
      this.pickables.push(branch);

      const clusters = 1 + Math.floor(rng() * 2);
      for (let c = 0; c < clusters; c++) {
        const id = `f${foliageIndex++}`;
        const color = FOLIAGE_BASE[foliageIndex % FOLIAGE_BASE.length];
        const foliage = new THREE.Mesh(
          new THREE.IcosahedronGeometry(randRange(rng, 0.16, 0.26), 1),
          new THREE.MeshStandardMaterial({
            color,
            roughness: 0.78,
            flatShading: true,
          }),
        );
        foliage.position.copy(end).add(
          new THREE.Vector3(randRange(rng, -0.08, 0.08), randRange(rng, 0.02, 0.1), randRange(rng, -0.08, 0.08)),
        );
        foliage.castShadow = true;
        foliage.userData.kind = "foliage";
        foliage.userData.foliageId = id;
        foliage.userData.bonsai = true;
        this.group.add(foliage);
        this.foliage.set(id, foliage);
        this.pickables.push(foliage);
        if (state.pruned.includes(id)) {
          /* applied later */
        }
      }
    }
  }

  private removeFoliage(id: string): void {
    const mesh = this.foliage.get(id);
    if (!mesh) return;
    this.group.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    this.foliage.delete(id);
    const idx = this.pickables.indexOf(mesh);
    if (idx >= 0) this.pickables.splice(idx, 1);
  }

  private applyWaterLook(state: BonsaiState): void {
    const lush = Math.min(1, 0.35 + state.wateredCount * 0.08);
    for (const mesh of this.foliage.values()) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.offsetHSL(0, 0.02 * lush, 0.015 * lush);
    }
  }

  private spawnDroplets(): void {
    for (let i = 0; i < 10; i++) {
      const drop = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 6, 6),
        new THREE.MeshStandardMaterial({
          color: 0x8fb4b8,
          transparent: true,
          opacity: 0.7,
          roughness: 0.2,
        }),
      );
      drop.position.set((Math.random() - 0.5) * 0.3, 1.15 + Math.random() * 0.2, (Math.random() - 0.5) * 0.3);
      this.group.add(drop);
      this.droplets.push(drop);
    }
  }
}
