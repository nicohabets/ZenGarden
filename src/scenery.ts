import * as THREE from "three";
import { mulberry32, randRange } from "./rng";
import { GARDEN, type BasinState, type LanternState, type MossState } from "./types";

export function createGround(): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x8d866f,
    roughness: 1,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(28, 48), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.08;
  mesh.receiveShadow = true;
  return mesh;
}

export function createFrame(): THREE.Group {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({
    color: 0x4a3828,
    roughness: 0.82,
    metalness: 0.04,
  });
  const w = GARDEN.width + 0.46;
  const d = GARDEN.depth + 0.46;
  const beam = (len: number, thick: number, high: number) =>
    new THREE.Mesh(new THREE.BoxGeometry(len, high, thick), wood);

  const longA = beam(w, 0.28, 0.22);
  longA.position.set(0, 0.08, d / 2);
  const longB = longA.clone();
  longB.position.z = -d / 2;
  const shortA = beam(0.28, d, 0.22);
  shortA.position.set(w / 2, 0.08, 0);
  const shortB = shortA.clone();
  shortB.position.x = -w / 2;

  for (const m of [longA, longB, shortA, shortB]) {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }

  const postGeo = new THREE.BoxGeometry(0.34, 0.32, 0.34);
  for (const [x, z] of [
    [w / 2, d / 2],
    [w / 2, -d / 2],
    [-w / 2, d / 2],
    [-w / 2, -d / 2],
  ] as const) {
    const post = new THREE.Mesh(postGeo, wood);
    post.position.set(x, 0.12, z);
    post.castShadow = true;
    group.add(post);
  }
  return group;
}

export function createMoss(states: MossState[]): THREE.Group {
  const group = new THREE.Group();
  const colors = [0x5a6848, 0x4d5c3e, 0x677352];
  for (const s of states) {
    const rng = mulberry32(hashFromId(s.id));
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshStandardMaterial({
        color: colors[Math.abs(hashFromId(s.id)) % colors.length],
        roughness: 0.95,
      }),
    );
    mesh.scale.set(s.scale * 0.55, s.scale * 0.16 + rng() * 0.04, s.scale * 0.48);
    mesh.position.set(s.x, GARDEN.sandY + 0.04, s.z);
    mesh.rotation.y = s.rotY;
    mesh.receiveShadow = true;
    mesh.userData.kind = "moss";
    group.add(mesh);
  }
  return group;
}

export function createBasin(state: BasinState): THREE.Group {
  const group = new THREE.Group();
  group.position.set(state.x, GARDEN.sandY, state.z);
  group.rotation.y = state.rotY;
  group.userData.kind = "basin";

  const stone = new THREE.MeshStandardMaterial({
    color: 0x6a6660,
    roughness: 0.88,
    flatShading: true,
  });

  const block = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.28, 1.15), stone);
  block.position.y = 0.12;
  block.castShadow = true;
  block.receiveShadow = true;
  block.userData.kind = "basin";
  group.add(block);

  const points: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const x = 0.18 + t * 0.28 + (t > 0.7 ? (t - 0.7) * 0.15 : 0);
    const y = 0.28 + t * 0.22;
    points.push(new THREE.Vector2(x, y));
  }
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(points, 20), stone);
  bowl.castShadow = true;
  bowl.userData.kind = "basin";
  group.add(bowl);

  const waterMat = new THREE.MeshPhysicalMaterial({
    color: 0x3a5558,
    roughness: 0.18,
    metalness: 0.08,
    transparent: true,
    opacity: 0.82,
    transmission: 0.25,
  });
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.34, 24), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.46;
  water.userData.kind = "basin";
  water.userData.water = true;
  group.add(water);

  const koiColors = [0xc45a32, 0xf2efe6];
  for (let i = 0; i < 2; i++) {
    const koi = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 8, 6),
      new THREE.MeshStandardMaterial({ color: koiColors[i], roughness: 0.35 }),
    );
    koi.scale.set(2.1, 0.55, 0.75);
    koi.position.y = 0.452;
    koi.userData.kind = "basin";
    koi.userData.koi = { angle: i * Math.PI, speed: 0.55 + i * 0.12, radius: 0.14 + i * 0.04 };
    group.add(koi);
  }

  return group;
}

export function createLantern(state: LanternState): THREE.Group {
  const group = new THREE.Group();
  group.position.set(state.x, GARDEN.sandY, state.z);
  group.rotation.y = state.rotY;
  group.userData.kind = "lantern";
  group.userData.id = state.id;

  const stone = new THREE.MeshStandardMaterial({
    color: 0x5e5a54,
    roughness: 0.86,
    flatShading: true,
  });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.34), stone);
  base.position.y = 0.06;
  base.castShadow = true;
  base.userData.kind = "lantern";
  group.add(base);

  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.32, 0.11), stone);
  shaft.position.y = 0.26;
  shaft.castShadow = true;
  shaft.userData.kind = "lantern";
  group.add(shaft);

  const glowMat = new THREE.MeshStandardMaterial({
    color: 0xf0c878,
    emissive: 0xc4893a,
    emissiveIntensity: 0.7,
    roughness: 0.4,
  });
  const chamber = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.2), glowMat);
  chamber.position.y = 0.48;
  chamber.userData.kind = "lantern";
  chamber.userData.lanternGlow = true;
  group.add(chamber);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.14, 4), stone);
  roof.position.y = 0.62;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  roof.userData.kind = "lantern";
  group.add(roof);

  const light = new THREE.PointLight(0xffc878, 0.55, 4.8, 2);
  light.position.y = 0.5;
  group.add(light);
  return group;
}

export function createLanterns(states: LanternState[]): THREE.Group {
  const group = new THREE.Group();
  for (const s of states) group.add(createLantern(s));
  return group;
}

export function createBackdrop(): THREE.Group {
  const group = new THREE.Group();
  const slat = new THREE.MeshStandardMaterial({
    color: 0x3f3428,
    roughness: 0.86,
  });
  const fence = new THREE.Group();
  for (let i = 0; i < 18; i++) {
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.15, 0.04), slat);
    board.position.set(-5 + i * 0.58, 0.55, -6.4);
    board.castShadow = true;
    fence.add(board);
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.08, 0.08), slat);
  rail.position.set(0.1, 1.05, -6.4);
  fence.add(rail);
  group.add(fence);
  return group;
}

export function updateWater(group: THREE.Group, time: number): void {
  group.traverse((obj: THREE.Object3D) => {
    if (obj instanceof THREE.Mesh && obj.userData.water) {
      const mat = obj.material as THREE.MeshPhysicalMaterial;
      const pulse = 0.5 + Math.sin(time * 0.7) * 0.08;
      mat.color.setRGB(0.22 + pulse * 0.05, 0.32 + pulse * 0.06, 0.34 + pulse * 0.04);
    }
    if (obj instanceof THREE.Mesh && obj.userData.koi) {
      const k = obj.userData.koi as { angle: number; speed: number; radius: number };
      k.angle += k.speed * 0.016;
      obj.position.x = Math.cos(k.angle) * k.radius;
      obj.position.z = Math.sin(k.angle) * k.radius;
      obj.rotation.y = -k.angle;
    }
  });
}

export function updateLanterns(group: THREE.Group, time: number): void {
  group.traverse((obj: THREE.Object3D) => {
    if (obj instanceof THREE.Mesh && obj.userData.lanternGlow) {
      const mat = obj.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.55 + Math.sin(time * 1.6) * 0.12;
    }
    if (obj instanceof THREE.PointLight) {
      obj.intensity = 0.48 + Math.sin(time * 1.6) * 0.08;
    }
  });
}

function hashFromId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function scatterGravel(seed: number): THREE.Group {
  const group = new THREE.Group();
  const rng = mulberry32(seed ^ 0x61c88647);
  const mat = new THREE.MeshStandardMaterial({ color: 0x9a917e, roughness: 1 });
  for (let i = 0; i < 40; i++) {
    const pebble = new THREE.Mesh(new THREE.DodecahedronGeometry(randRange(rng, 0.04, 0.09), 0), mat);
    const angle = rng() * Math.PI * 2;
    const rad = 7.4 + rng() * 4;
    pebble.position.set(Math.cos(angle) * rad, -0.02, Math.sin(angle) * rad);
    pebble.rotation.set(rng(), rng(), rng());
    group.add(pebble);
  }
  return group;
}
