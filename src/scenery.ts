import * as THREE from "three";
import { mulberry32, randRange } from "./rng";
import { GARDEN, type BasinState, type LanternState, type MossState } from "./types";

function clayTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("clay texture");
  ctx.fillStyle = "#d2a86a";
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    const x = (i * 17) % 128;
    const y = (i * 31 + 5) % 128;
    ctx.fillStyle = i % 4 === 0 ? "#b88a52" : i % 3 === 0 ? "#e0ba7c" : "#c89860";
    ctx.fillRect(x, y, 2, 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 1.2);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createGround(): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x7a7468,
    roughness: 1,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(42, 36), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.1;
  mesh.receiveShadow = true;
  return mesh;
}

export function createFrame(): THREE.Group {
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({
    color: 0x3a3228,
    roughness: 0.9,
    metalness: 0.02,
  });
  const w = GARDEN.width + 0.38;
  const d = GARDEN.depth + 0.38;
  const beam = (len: number, thick: number, high: number) =>
    new THREE.Mesh(new THREE.BoxGeometry(len, high, thick), wood);

  const longA = beam(w, 0.22, 0.16);
  longA.position.set(0, 0.05, d / 2);
  const longB = longA.clone();
  longB.position.z = -d / 2;
  const shortA = beam(0.22, d, 0.16);
  shortA.position.set(w / 2, 0.05, 0);
  const shortB = shortA.clone();
  shortB.position.x = -w / 2;

  for (const m of [longA, longB, shortA, shortB]) {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

function islandGeometry(seed: number): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 32, 22);
  const rng = mulberry32(seed);
  const pos = geo.attributes.position;
  const color = new THREE.Float32BufferAttribute(pos.count * 3, 3);
  const v = new THREE.Vector3();
  const earth = new THREE.Color(0x5c4e3a);
  const moss = new THREE.Color(0x3f4c34);
  const mossLite = new THREE.Color(0x536246);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const wobble =
      0.22 * Math.sin(v.x * 2.4 + seed) +
      0.16 * Math.cos(v.z * 3.1 + seed * 0.7) +
      0.1 * Math.sin(v.x * 5.6 + v.z * 4.8 + seed) +
      0.07 * (rng() - 0.5);
    v.addScaledVector(n, wobble);
    v.x *= 1.05 + 0.08 * Math.sin(seed + v.z * 2.0);
    v.z *= 0.88 + 0.1 * Math.cos(seed * 0.4 + v.x * 1.6);
    v.y = v.y * 0.42 + 0.18;
    if (v.y < 0.02) v.y = 0.02 * rng();
    pos.setXYZ(i, v.x, v.y, v.z);
    const c = v.y < 0.12 ? earth.clone().lerp(moss, 0.25) : moss.clone().lerp(mossLite, rng() * 0.45);
    color.setXYZ(i, c.r, c.g, c.b);
  }
  geo.setAttribute("color", color);
  geo.computeVertexNormals();
  return geo;
}

function mossTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("moss texture");
  ctx.fillStyle = "#445238";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2200; i++) {
    const x = (i * 29 + 3) % size;
    const y = (i * 47 + 11) % size;
    ctx.fillStyle = i % 5 === 0 ? "#2e3a28" : i % 3 === 0 ? "#5a6848" : "#3c4a32";
    ctx.fillRect(x, y, 1 + (i % 2), 1);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.2, 2.2);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

let mossMap: THREE.CanvasTexture | null = null;

export function createMoss(states: MossState[]): THREE.Group {
  const group = new THREE.Group();
  mossMap ??= mossTexture();
  const earth = new THREE.MeshStandardMaterial({
    color: 0x5a4c3a,
    roughness: 0.98,
    metalness: 0,
  });
  const mossMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: mossMap,
    roughness: 0.98,
    metalness: 0,
    vertexColors: true,
  });
  for (const s of states) {
    const seed = hashFromId(s.id);
    const rng = mulberry32(seed);
    const island = new THREE.Group();
    island.position.set(s.x, GARDEN.sandY - 0.02, s.z);
    island.rotation.y = s.rotY;
    island.userData.kind = "moss";

    const soil = new THREE.Mesh(islandGeometry(seed ^ 0x51), earth);
    soil.scale.set(s.scale * 0.62, s.scale * 0.22, s.scale * 0.54);
    soil.position.y = -0.01;
    soil.receiveShadow = true;
    soil.castShadow = true;
    soil.userData.kind = "moss";
    island.add(soil);

    const moss = new THREE.Mesh(islandGeometry(seed), mossMat);
    moss.scale.set(s.scale * 0.55, s.scale * 0.32, s.scale * 0.48);
    moss.position.y = 0.01;
    moss.receiveShadow = true;
    moss.castShadow = true;
    moss.userData.kind = "moss";
    island.add(moss);

    const pillows = 2 + ((seed >> 3) % 3);
    for (let p = 0; p < pillows; p++) {
      const bump = new THREE.Mesh(islandGeometry(seed ^ (17 + p * 13)), mossMat);
      bump.scale.set(s.scale * randRange(rng, 0.16, 0.28), s.scale * randRange(rng, 0.08, 0.14), s.scale * randRange(rng, 0.14, 0.24));
      bump.position.set(
        randRange(rng, -0.28, 0.28) * s.scale,
        0.03,
        randRange(rng, -0.22, 0.22) * s.scale,
      );
      bump.rotation.y = rng() * Math.PI;
      bump.receiveShadow = true;
      bump.userData.kind = "moss";
      island.add(bump);
    }
    group.add(island);
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
    roughness: 0.9,
    metalness: 0.03,
    flatShading: true,
  });

  const block = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.22, 0.95), stone);
  block.position.y = 0.1;
  block.castShadow = true;
  block.receiveShadow = true;
  block.userData.kind = "basin";
  group.add(block);

  const points: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const x = 0.15 + t * 0.22 + (t > 0.7 ? (t - 0.7) * 0.12 : 0);
    const y = 0.22 + t * 0.18;
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
  const water = new THREE.Mesh(new THREE.CircleGeometry(0.28, 24), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.38;
  water.userData.kind = "basin";
  water.userData.water = true;
  group.add(water);

  const koiColors = [0xc45a32, 0xf2efe6];
  for (let i = 0; i < 2; i++) {
    const koi = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 8, 6),
      new THREE.MeshStandardMaterial({ color: koiColors[i], roughness: 0.35 }),
    );
    koi.scale.set(2.1, 0.55, 0.75);
    koi.position.y = 0.372;
    koi.userData.kind = "basin";
    koi.userData.koi = { angle: i * Math.PI, speed: 0.55 + i * 0.12, radius: 0.11 + i * 0.03 };
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
    roughness: 0.88,
    flatShading: true,
  });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.3), stone);
  base.position.y = 0.05;
  base.castShadow = true;
  base.userData.kind = "lantern";
  group.add(base);

  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.28, 0.1), stone);
  shaft.position.y = 0.22;
  shaft.castShadow = true;
  shaft.userData.kind = "lantern";
  group.add(shaft);

  const glowMat = new THREE.MeshStandardMaterial({
    color: 0xf0c878,
    emissive: 0xc4893a,
    emissiveIntensity: 0.55,
    roughness: 0.4,
  });
  const chamber = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.18), glowMat);
  chamber.position.y = 0.42;
  chamber.userData.kind = "lantern";
  chamber.userData.lanternGlow = true;
  group.add(chamber);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.12, 4), stone);
  roof.position.y = 0.54;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  roof.userData.kind = "lantern";
  group.add(roof);

  const light = new THREE.PointLight(0xffc878, 0.4, 4.2, 2);
  light.position.y = 0.44;
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
  const clay = new THREE.MeshStandardMaterial({
    color: 0xe0b878,
    map: clayTexture(),
    roughness: 0.92,
    metalness: 0,
    emissive: 0x3a2810,
    emissiveIntensity: 0.08,
  });
  const tile = new THREE.MeshStandardMaterial({
    color: 0x2a2622,
    roughness: 0.86,
    metalness: 0.04,
  });

  const wallH = 1.72;
  const wallY = wallH / 2 - 0.02;
  const thick = 0.18;
  const backZ = -GARDEN.depth / 2 - 0.72;
  const sideX = GARDEN.width / 2 + 0.82;
  const backW = GARDEN.width + 1.9;
  const sideL = GARDEN.depth + 1.15;

  const back = new THREE.Mesh(new THREE.BoxGeometry(backW, wallH, thick), clay);
  back.position.set(0, wallY, backZ);
  back.castShadow = true;
  group.add(back);

  const left = new THREE.Mesh(new THREE.BoxGeometry(thick, wallH, sideL), clay);
  left.position.set(-sideX, wallY, -0.2);
  left.castShadow = true;
  group.add(left);

  const right = new THREE.Mesh(new THREE.BoxGeometry(thick, wallH, sideL), clay);
  right.position.set(sideX, wallY, -0.2);
  right.castShadow = true;
  group.add(right);

  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(GARDEN.width + 0.6, 0.09, 1.35),
    new THREE.MeshStandardMaterial({ color: 0x4a4034, roughness: 0.88 }),
  );
  deck.position.set(0, -0.01, GARDEN.depth / 2 + 0.85);
  deck.receiveShadow = true;
  group.add(deck);

  const cap = (w: number, d: number, x: number, z: number, rotY = 0) => {
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), tile);
    roof.position.set(x, wallH + 0.02, z);
    roof.rotation.y = rotY;
    roof.castShadow = true;
    group.add(roof);
  };
  cap(backW + 0.28, 0.36, 0, backZ);
  cap(0.36, sideL + 0.16, -sideX, -0.2);
  cap(0.36, sideL + 0.16, sideX, -0.2);

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
      mat.emissiveIntensity = 0.45 + Math.sin(time * 1.6) * 0.1;
    }
    if (obj instanceof THREE.PointLight) {
      obj.intensity = 0.36 + Math.sin(time * 1.6) * 0.06;
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
  const mat = new THREE.MeshStandardMaterial({ color: 0x9a968c, roughness: 1 });
  for (let i = 0; i < 28; i++) {
    const pebble = new THREE.Mesh(new THREE.DodecahedronGeometry(randRange(rng, 0.035, 0.08), 0), mat);
    const side = rng() > 0.5 ? 1 : -1;
    pebble.position.set(
      side * (GARDEN.width / 2 + 1.6 + rng() * 2.4),
      -0.03,
      randRange(rng, -GARDEN.depth / 2 - 0.4, GARDEN.depth / 2 + 1.2),
    );
    pebble.rotation.set(rng(), rng(), rng());
    group.add(pebble);
  }
  return group;
}
