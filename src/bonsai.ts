import * as THREE from "three";
import { mulberry32, randRange } from "./rng";
import { GARDEN, seasonFromBonsai, type BonsaiState, type Season } from "./types";

const SEASON_COLORS: Record<Season, number[]> = {
  spring: [0x6e8a4e, 0x88a05c, 0xd9a7b0, 0x5c7344],
  summer: [0x3f5a32, 0x4f6b3c, 0x2f4a28, 0x5a7344],
  autumn: [0x8a5a2c, 0xb06a32, 0x6e3e1e, 0xc4843c],
  winter: [0x5a5346, 0x6a6456, 0x4a463c, 0x7a7264],
};

function taperTube(geo: THREE.BufferGeometry, tubular: number, radial: number, startScale: number, endScale: number): void {
  const pos = geo.attributes.position;
  const cols = radial + 1;
  const v = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    const s = startScale + (endScale - startScale) * t;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let j = 0; j < cols; j++) {
      const idx = i * cols + j;
      cx += pos.getX(idx);
      cy += pos.getY(idx);
      cz += pos.getZ(idx);
    }
    cx /= cols;
    cy /= cols;
    cz /= cols;
    for (let j = 0; j < cols; j++) {
      const idx = i * cols + j;
      v.fromBufferAttribute(pos, idx);
      pos.setXYZ(idx, cx + (v.x - cx) * s, cy + (v.y - cy) * s, cz + (v.z - cz) * s);
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

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
    this.build();
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
      const flatten = (mesh.userData.flatten as number) ?? 1;
      const s = rest * grow * winterShrink;
      mesh.scale.set(s, s * flatten, s);
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

  private build(): void {
    const rng = mulberry32(this.seed ^ 0xb0a51);
    const bark = new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.9 });
    const twig = new THREE.MeshStandardMaterial({ color: 0x3d2c20, roughness: 0.92 });

    const pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.62, 0.52, 0.36, 22),
      new THREE.MeshStandardMaterial({
        color: 0x6d3a32,
        roughness: 0.45,
        metalness: 0.08,
      }),
    );
    pot.position.y = 0.2;
    pot.castShadow = true;
    pot.receiveShadow = true;
    pot.userData.kind = "bonsai";
    this.group.add(pot);
    this.pickables.push(pot);

    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.62, 0.045, 8, 24),
      new THREE.MeshStandardMaterial({ color: 0x5a2f2a, roughness: 0.5 }),
    );
    rim.position.y = 0.38;
    rim.rotation.x = Math.PI / 2;
    rim.userData.kind = "bonsai";
    this.group.add(rim);
    this.pickables.push(rim);

    this.soil = new THREE.MeshStandardMaterial({
      color: 0x3b3226,
      roughness: 1,
    });
    const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.05, 16), this.soil);
    soil.position.y = 0.38;
    soil.userData.kind = "bonsai";
    this.group.add(soil);
    this.pickables.push(soil);

    const lean = randRange(rng, -0.16, 0.16);
    const trunkPts: THREE.Vector3[] = [];
    for (let i = 0; i < 12; i++) {
      const t = i / 11;
      const y = 0.38 + t * 2.15;
      const x = Math.sin(t * Math.PI * 1.15) * 0.38 + lean * t;
      const z = Math.sin(t * Math.PI * 0.75 + 0.45) * 0.2;
      trunkPts.push(new THREE.Vector3(x, y, z));
    }
    const trunkCurve = new THREE.CatmullRomCurve3(trunkPts);
    const trunkGeo = new THREE.TubeGeometry(trunkCurve, 28, 0.132, 8, false);
    taperTube(trunkGeo, 28, 8, 1.2, 0.36);
    const trunk = new THREE.Mesh(trunkGeo, bark);
    trunk.castShadow = true;
    trunk.userData.kind = "bonsai";
    this.group.add(trunk);
    this.pickables.push(trunk);

    for (let r = 0; r < 4; r++) {
      const a = (r / 4) * Math.PI * 2 + rng() * 0.3;
      const start = trunkPts[0].clone();
      const end = start.clone().add(new THREE.Vector3(Math.cos(a) * 0.28, -0.1, Math.sin(a) * 0.28));
      const root = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([start, end]), 5, 0.036, 5, false), bark);
      root.castShadow = true;
      root.userData.kind = "bonsai";
      this.group.add(root);
    }

    const branchCount = 9 + Math.floor(rng() * 4);
    let foliageIndex = 0;
    const addFoliage = (at: THREE.Vector3, spread: number) => {
      const id = `f${foliageIndex++}`;
      const restScale = randRange(rng, 0.95, 1.22);
      const flatten = randRange(rng, 0.62, 0.78);
      const foliage = new THREE.Mesh(
        new THREE.IcosahedronGeometry(randRange(rng, 0.2, 0.32), 1),
        new THREE.MeshStandardMaterial({
          color: SEASON_COLORS[this.season][foliageIndex % 4],
          roughness: 0.78,
          flatShading: true,
        }),
      );
      foliage.position.copy(at).add(
        new THREE.Vector3(randRange(rng, -spread, spread), randRange(rng, 0.02, 0.14), randRange(rng, -spread, spread)),
      );
      foliage.castShadow = true;
      foliage.userData.kind = "foliage";
      foliage.userData.foliageId = id;
      foliage.userData.bonsai = true;
      foliage.userData.restScale = restScale;
      foliage.userData.flatten = flatten;
      foliage.userData.restRot = foliage.rotation.clone();
      this.group.add(foliage);
      this.foliage.set(id, foliage);
      this.pickables.push(foliage);
    };

    for (let b = 0; b < branchCount; b++) {
      const t = 0.2 + (b / Math.max(1, branchCount - 1)) * 0.74;
      const origin = trunkCurve.getPoint(t);
      const side = b % 2 === 0 ? 1 : -1;
      const yaw = side * (0.65 + rng() * 0.85) + b * 0.35;
      const reach = (1.35 - t * 0.4) * randRange(rng, 0.52, 0.92);
      const dir = new THREE.Vector3(Math.cos(yaw), randRange(rng, 0.06, 0.36) * (t > 0.78 ? 0.7 : 1), Math.sin(yaw)).normalize();
      const mid = origin.clone().addScaledVector(dir, reach * 0.55);
      mid.y += randRange(rng, -0.04, 0.08);
      const end = origin.clone().addScaledVector(dir, reach);
      const branchGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([origin, mid, end]), 10, 0.038, 6, false);
      taperTube(branchGeo, 10, 6, 1, 0.42);
      const branch = new THREE.Mesh(branchGeo, bark);
      branch.castShadow = true;
      branch.userData.kind = "bonsai";
      this.group.add(branch);
      this.pickables.push(branch);

      const clusters = 3 + (rng() > 0.45 ? 1 : 0);
      for (let c = 0; c < clusters; c++) {
        const along = THREE.MathUtils.lerp(0.45, 1, c / Math.max(1, clusters - 1));
        const at = origin.clone().lerp(end, along);
        addFoliage(at, 0.12);
      }

      if (rng() > 0.32 && t < 0.82) {
        const twigDir = new THREE.Vector3(randRange(rng, -1, 1), randRange(rng, 0.1, 0.55), randRange(rng, -1, 1)).normalize();
        const twigEnd = end.clone().addScaledVector(twigDir, randRange(rng, 0.18, 0.34));
        const twigMesh = new THREE.Mesh(
          new THREE.TubeGeometry(new THREE.CatmullRomCurve3([end, twigEnd]), 5, 0.012, 5, false),
          twig,
        );
        twigMesh.castShadow = true;
        twigMesh.userData.kind = "bonsai";
        this.group.add(twigMesh);
        this.pickables.push(twigMesh);
        addFoliage(twigEnd, 0.08);
        if (rng() > 0.4) addFoliage(twigEnd, 0.1);
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
    for (let i = 0; i < 12; i++) {
      const drop = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 6, 6),
        new THREE.MeshStandardMaterial({
          color: 0x8fb4b8,
          transparent: true,
          opacity: 0.7,
          roughness: 0.2,
        }),
      );
      drop.position.set((Math.random() - 0.5) * 0.42, 1.55 + Math.random() * 0.35, (Math.random() - 0.5) * 0.42);
      this.group.add(drop);
      this.droplets.push(drop);
    }
  }

  private spawnPetals(season: Season): void {
    const color = season === "autumn" ? 0xc4843c : 0xe6b4be;
    for (let i = 0; i < 16; i++) {
      const petal = new THREE.Mesh(
        new THREE.CircleGeometry(0.028, 5),
        new THREE.MeshStandardMaterial({
          color,
          side: THREE.DoubleSide,
          roughness: 0.7,
        }),
      );
      petal.position.set((Math.random() - 0.5) * 0.7, 1.2 + Math.random() * 0.7, (Math.random() - 0.5) * 0.7);
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
