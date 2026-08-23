import * as THREE from "three";
import { mulberry32, randRange } from "./rng";
import { GARDEN, seasonFromBonsai, type BonsaiState, type Season } from "./types";

const SEASON_COLORS: Record<Season, number[]> = {
  spring: [0x6e8a4e, 0x88a05c, 0xd9a7b0, 0x5c7344],
  summer: [0x3f5a32, 0x4f6b3c, 0x2f4a28, 0x5a7344],
  autumn: [0x8a5a2c, 0xb06a32, 0x6e3e1e, 0xc4843c],
  winter: [0x5a5346, 0x6a6456, 0x4a463c, 0x7a7264],
};

export class Bonsai {
  readonly group = new THREE.Group();
  readonly pickables: THREE.Object3D[] = [];
  readonly foliage = new Map<string, THREE.Mesh>();
  private soil!: THREE.MeshStandardMaterial;
  private wetUntil = 0;
  private droplets: THREE.Mesh[] = [];
  private petals: THREE.Mesh[] = [];
  private season: Season = "spring";

  constructor(
    readonly seed: number,
    state: BonsaiState,
    season: Season,
  ) {
    this.group.userData.kind = "bonsai";
    this.season = season;
    this.build(state);
    this.setPose(state.x, state.z, state.rotY);
    for (const id of state.pruned) this.removeFoliage(id);
    this.applySeason(state, season);
  }

  setPose(x: number, z: number, rotY: number): void {
    this.group.position.set(x, GARDEN.sandY, z);
    this.group.rotation.y = rotY;
  }

  prune(id: string): boolean {
    if (!this.foliage.has(id)) return false;
    if (this.foliage.size <= 3) return false;
    this.removeFoliage(id);
    return true;
  }

  water(state: BonsaiState): Season {
    state.wateredCount += 1;
    state.lastWatered = Date.now();
    const season = seasonFromBonsai(state);
    this.wetUntil = performance.now() + 4200;
    this.soil.color.setHex(0x2a2218);
    this.spawnDroplets();
    if (season === "spring" || season === "autumn") this.spawnPetals(season);
    this.applySeason(state, season);
    return season;
  }

  applySeason(state: BonsaiState, season: Season): void {
    this.season = season;
    const palette = SEASON_COLORS[season];
    const grow = 1 + Math.min(0.38, state.wateredCount * 0.07);
    const winterShrink = season === "winter" ? 0.78 : 1;
    let i = 0;
    for (const mesh of this.foliage.values()) {
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.setHex(palette[i % palette.length]);
      const rest = (mesh.userData.restScale as number) ?? 1;
      const s = rest * grow * winterShrink;
      mesh.scale.setScalar(s);
      i += 1;
    }
  }

  update(now: number, elapsed: number): void {
    if (this.wetUntil && now > this.wetUntil) {
      this.soil.color.setHex(0x3b3226);
      this.wetUntil = 0;
    }
    let f = 0;
    for (const mesh of this.foliage.values()) {
      const rest = mesh.userData.restRot as THREE.Euler;
      const sway = Math.sin(elapsed * 1.15 + f * 0.7) * 0.045;
      mesh.rotation.z = rest.z + sway;
      mesh.rotation.x = rest.x + sway * 0.35;
      f += 1;
    }
    for (let i = this.droplets.length - 1; i >= 0; i--) {
      const d = this.droplets[i];
      d.position.y -= 0.018;
      d.scale.multiplyScalar(0.96);
      if (d.position.y < 0.12) this.disposeMesh(d, this.droplets, i);
    }
    for (let i = this.petals.length - 1; i >= 0; i--) {
      const p = this.petals[i];
      p.position.y -= 0.006 + (p.userData.fall as number);
      p.position.x += Math.sin(elapsed * 1.4 + i) * 0.004;
      p.rotation.z += 0.03;
      if (p.position.y < 0.05) this.disposeMesh(p, this.petals, i);
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
    for (let i = 0; i < 8; i++) {
      const y = 0.3 + i * 0.17;
      x += randRange(rng, -0.08, 0.09);
      z += randRange(rng, -0.06, 0.06);
      trunkPts.push(new THREE.Vector3(x, y, z));
    }
    const trunk = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(trunkPts), 22, 0.055, 8, false),
      new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.86 }),
    );
    trunk.castShadow = true;
    trunk.userData.kind = "bonsai";
    this.group.add(trunk);
    this.pickables.push(trunk);

    const branchCount = 6 + Math.floor(rng() * 3);
    let foliageIndex = 0;
    for (let b = 0; b < branchCount; b++) {
      const t = 0.28 + rng() * 0.65;
      const origin = trunkPts[Math.min(trunkPts.length - 1, Math.floor(t * (trunkPts.length - 1)))];
      const dir = new THREE.Vector3(randRange(rng, -1, 1), randRange(rng, 0.15, 0.85), randRange(rng, -1, 1)).normalize();
      const length = randRange(rng, 0.26, 0.58);
      const end = origin.clone().addScaledVector(dir, length);
      const branch = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3([origin, end]), 8, 0.016, 6, false),
        new THREE.MeshStandardMaterial({ color: 0x3d2c20, roughness: 0.9 }),
      );
      branch.castShadow = true;
      branch.userData.kind = "bonsai";
      this.group.add(branch);
      this.pickables.push(branch);

      const clusters = 2 + Math.floor(rng() * 2);
      for (let c = 0; c < clusters; c++) {
        const id = `f${foliageIndex++}`;
        const restScale = randRange(rng, 0.85, 1.15);
        const foliage = new THREE.Mesh(
          new THREE.IcosahedronGeometry(randRange(rng, 0.14, 0.24), 1),
          new THREE.MeshStandardMaterial({
            color: SEASON_COLORS[this.season][foliageIndex % 4],
            roughness: 0.78,
            flatShading: true,
          }),
        );
        foliage.position.copy(end).add(
          new THREE.Vector3(randRange(rng, -0.1, 0.1), randRange(rng, 0.02, 0.12), randRange(rng, -0.1, 0.1)),
        );
        foliage.castShadow = true;
        foliage.userData.kind = "foliage";
        foliage.userData.foliageId = id;
        foliage.userData.bonsai = true;
        foliage.userData.restScale = restScale;
        foliage.userData.restRot = foliage.rotation.clone();
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

  private spawnPetals(season: Season): void {
    const color = season === "autumn" ? 0xc4843c : 0xe6b4be;
    for (let i = 0; i < 14; i++) {
      const petal = new THREE.Mesh(
        new THREE.CircleGeometry(0.028, 5),
        new THREE.MeshStandardMaterial({
          color,
          side: THREE.DoubleSide,
          roughness: 0.7,
        }),
      );
      petal.position.set((Math.random() - 0.5) * 0.5, 0.9 + Math.random() * 0.5, (Math.random() - 0.5) * 0.5);
      petal.rotation.set(Math.random(), Math.random(), Math.random());
      petal.userData.fall = Math.random() * 0.004;
      this.group.add(petal);
      this.petals.push(petal);
    }
  }

  private disposeMesh(mesh: THREE.Mesh, list: THREE.Mesh[], index: number): void {
    this.group.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    list.splice(index, 1);
  }
}
