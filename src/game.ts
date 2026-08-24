import * as THREE from "three";
import { Bonsai } from "./bonsai";
import { CameraRig } from "./camera";
import { generateWorld, inBounds, nextStoneId } from "./generate";
import { loadSave, writeSave } from "./persistence";
import { RakeGuide, type RakeIsland, type RakePiece } from "./rake";
import { SandField } from "./sand";
import {
  createBackdrop,
  createBasin,
  createFrame,
  createGround,
  createLanterns,
  createMoss,
  scatterGravel,
  updateLanterns,
  updateWater,
} from "./scenery";
import { StoneField } from "./stones";
import {
  seasonFromBonsai,
  type BasinState,
  type Blocker,
  type BonsaiState,
  type GardenSave,
  type LanternState,
  type MossState,
  type RakeMode,
  type StoneState,
  type ToolId,
  type ZenGardenAPI,
} from "./types";
import { GardenUI } from "./ui";
import { freshSeed, hashSeed } from "./rng";

interface Pointer {
  id: number;
  x: number;
  y: number;
  button: number;
}

export class ZenGarden {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hit = new THREE.Vector3();
  private readonly pointers = new Map<number, Pointer>();

  private readonly cam = new CameraRig();
  private readonly ui = new GardenUI();
  private readonly sand: SandField;
  private readonly rakeGuide = new RakeGuide();
  private readonly stones = new StoneField();

  private seed: number;
  private tool: ToolId = "rake";
  private bonsai!: Bonsai;
  private bonsaiState!: BonsaiState;
  private basinState!: BasinState;
  private mossStates: MossState[] = [];
  private lanternStates: LanternState[] = [];
  private mossGroup: THREE.Group | null = null;
  private basinGroup: THREE.Group | null = null;
  private gravelGroup: THREE.Group | null = null;
  private lanternGroup: THREE.Group | null = null;
  private waterTime = 0;

  private mode: "idle" | "rake" | "orbit" | "pan" | "pinch" | "drag-stone" | "drag-bonsai" = "idle";
  private lastPointer: Pointer | null = null;
  private pinchDist = 0;
  private dragId: string | null = null;
  private saveTimer = 0;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.background = new THREE.Color(0xd6d2ca);
    this.scene.fog = new THREE.Fog(0xd6d2ca, 26, 52);

    this.sand = new SandField();
    this.seed = freshSeed();

    this.lights();
    this.scene.add(createGround());
    this.scene.add(createFrame());
    this.scene.add(createBackdrop());
    this.scene.add(this.sand.mesh);
    this.scene.add(this.stones.group);

    this.bindUi();
    this.bindInput();
    this.cam.setAspect(window.innerWidth / window.innerHeight);
  }

  async start(): Promise<void> {
    const saved = loadSave();
    if (saved) {
      await this.restore(saved);
    } else {
      this.plant(freshSeed());
      this.scheduleSave(true);
    }
    this.ui.setTool(this.tool);
    this.ui.setSeed(this.seed);
    this.ui.setSeason(seasonFromBonsai(this.bonsaiState));
    this.resize();
    this.renderer.render(this.scene, this.cam.camera);
    this.ui.setReady(true, true);
    this.exposeApi();
    this.tick();
  }

  flushSave(): void {
    this.persist();
  }

  private plant(seed: number): void {
    this.seed = seed;
    const world = generateWorld(seed);
    this.bonsaiState = { ...world.bonsai, pruned: [...world.bonsai.pruned] };
    this.basinState = { ...world.basin };
    this.mossStates = world.moss.map((m) => ({ ...m }));
    this.lanternStates = world.lanterns.map((l) => ({ ...l }));
    this.rebuildLiving(world.stones);
    this.ui.setSeason(seasonFromBonsai(this.bonsaiState));
    this.sand.paintBase(hashSeed(seed));
    this.sand.paintParallel(seed);
    for (const island of this.rakeIslands()) {
      this.sand.paintRing(island.x, island.z, island.innerR + 1.15, island.innerR, 0.165);
    }
    this.sand.flush();
    this.ui.setSeed(seed);
  }

  private async restore(save: GardenSave): Promise<void> {
    this.seed = save.seed;
    this.bonsaiState = { ...save.bonsai, pruned: [...save.bonsai.pruned] };
    this.basinState = { ...save.basin };
    this.mossStates = (save.moss ?? []).map((m) => ({ ...m }));
    this.lanternStates = (save.lanterns ?? generateWorld(save.seed).lanterns).map((l) => ({ ...l }));
    this.rebuildLiving(save.stones);
    this.sand.paintBase(hashSeed(save.seed));
    if (save.sand) {
      try {
        await this.sand.importDataUrl(save.sand);
      } catch {
        this.sand.paintParallel(save.seed);
      }
    } else {
      this.sand.paintParallel(save.seed);
    }
    this.cam.applyState(save.camera);
    this.ui.setSeed(save.seed);
  }

  private rebuildLiving(stones: StoneState[]): void {
    if (this.bonsai) this.scene.remove(this.bonsai.group);
    if (this.mossGroup) this.scene.remove(this.mossGroup);
    if (this.basinGroup) this.scene.remove(this.basinGroup);
    if (this.gravelGroup) this.scene.remove(this.gravelGroup);
    if (this.lanternGroup) this.scene.remove(this.lanternGroup);

    this.stones.load(stones.map((s) => ({ ...s })));
    this.bonsai = new Bonsai(this.seed, this.bonsaiState, seasonFromBonsai(this.bonsaiState));
    this.scene.add(this.bonsai.group);
    this.mossGroup = createMoss(this.mossStates);
    this.scene.add(this.mossGroup);
    this.basinGroup = createBasin(this.basinState);
    this.scene.add(this.basinGroup);
    this.lanternGroup = createLanterns(this.lanternStates);
    this.scene.add(this.lanternGroup);
    this.gravelGroup = scatterGravel(this.seed);
    this.scene.add(this.gravelGroup);
  }

  private lights(): void {
    const hemi = new THREE.HemisphereLight(0xf2f0ea, 0x7a766c, 0.78);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff6ea, 1.22);
    sun.position.set(7.5, 14, 5.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1536, 1536);
    sun.shadow.camera.near = 2;
    sun.shadow.camera.far = 42;
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    sun.shadow.bias = -0.0007;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xd0d6dc, 0.38);
    fill.position.set(-8, 6, -4);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xe8e4dc, 0.18);
    rim.position.set(2, 4, -9);
    this.scene.add(rim);
    this.scene.add(new THREE.AmbientLight(0xe8e4dc, 0.28));
  }

  private bindUi(): void {
    this.ui.onToolClick((tool) => this.setTool(tool));
    this.ui.newBtn.addEventListener("click", () => this.ui.showNewDialog(true));
    this.ui.keepBtn.addEventListener("click", () => this.ui.showNewDialog(false));
    this.ui.beginBtn.addEventListener("click", () => {
      this.ui.showNewDialog(false);
      this.plant(freshSeed());
      this.scheduleSave(true);
    });
    this.ui.dialog.addEventListener("click", (e) => {
      if (e.target === this.ui.dialog) this.ui.showNewDialog(false);
    });
  }

  private bindInput(): void {
    const el = this.canvas;
    el.addEventListener("pointerdown", (e) => this.onDown(e));
    el.addEventListener("pointermove", (e) => this.onMove(e));
    el.addEventListener("pointerup", (e) => this.onUp(e));
    el.addEventListener("pointercancel", (e) => this.onUp(e));
    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.cam.dolly(e.deltaY > 0 ? 0.08 : -0.08);
        this.scheduleSave();
      },
      { passive: false },
    );
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("keydown", (e) => this.onKey(e));
    window.addEventListener("pagehide", () => this.persist());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.persist();
    });
  }

  private onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    const map: Record<string, ToolId> = {
      "1": "rake",
      "2": "stone",
      "3": "water",
      "4": "prune",
      "5": "place",
    };
    if (map[e.key]) this.setTool(map[e.key]);
    if (e.key === "n" || e.key === "N") this.ui.showNewDialog(true);
    if (e.key === "Escape") this.ui.showNewDialog(false);
  }

  private waterBonsai(): ReturnType<typeof seasonFromBonsai> {
    const season = this.bonsai.water(this.bonsaiState);
    this.ui.setSeason(season);
    this.scheduleSave(true);
    return season;
  }

  private setTool(tool: ToolId): void {
    this.tool = tool;
    this.ui.setTool(tool);
  }

  private onDown(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    const p = { id: e.pointerId, x: e.clientX, y: e.clientY, button: e.button };
    this.pointers.set(e.pointerId, p);

    if (this.pointers.size === 2) {
      this.mode = "pinch";
      this.pinchDist = this.fingerDistance();
      return;
    }

    if (e.button === 2 || e.altKey) {
      this.mode = "orbit";
      this.lastPointer = p;
      return;
    }
    if (e.button === 1 || e.shiftKey) {
      this.mode = "pan";
      this.lastPointer = p;
      return;
    }

    const hit = this.pick(e.clientX, e.clientY);
    if (!hit) return;

    if (this.tool === "rake" && (hit.kind === "sand" || hit.kind === "moss")) {
      this.mode = "rake";
      this.rakeGuide.begin(hit.x, hit.z);
      return;
    }
    if (this.tool === "stone" && hit.kind === "stone" && hit.id) {
      this.mode = "drag-stone";
      this.dragId = hit.id;
      return;
    }
    if (this.tool === "stone" && hit.kind === "sand") {
      this.tryPlaceStone(hit.x, hit.z);
      return;
    }
    if (this.tool === "water" && (hit.kind === "bonsai" || hit.kind === "foliage")) {
      this.waterBonsai();
      return;
    }
    if (this.tool === "prune" && hit.kind === "foliage" && hit.foliageId) {
      if (this.bonsai.prune(hit.foliageId)) {
        this.bonsaiState.pruned.push(hit.foliageId);
        this.scheduleSave(true);
      }
      return;
    }
    if (this.tool === "place" && (hit.kind === "bonsai" || hit.kind === "foliage")) {
      this.mode = "drag-bonsai";
      return;
    }
  }

  private onMove(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId);
    this.pointers.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY, button: e.button });

    if (this.mode === "pinch" && this.pointers.size >= 2) {
      const dist = this.fingerDistance();
      if (this.pinchDist > 0) {
        const ratio = this.pinchDist / dist;
        this.cam.dolly(ratio - 1);
      }
      this.pinchDist = dist;
      const [a, b] = [...this.pointers.values()];
      if (prev && a && b) {
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        const old = this.lastPointer;
        if (old) this.cam.orbit(midX - old.x, midY - old.y);
        this.lastPointer = { id: -1, x: midX, y: midY, button: 0 };
      }
      return;
    }

    if (this.mode === "orbit" && prev) {
      this.cam.orbit(e.clientX - prev.x, e.clientY - prev.y);
      return;
    }
    if (this.mode === "pan" && prev) {
      this.cam.pan(e.clientX - prev.x, e.clientY - prev.y);
      return;
    }

    const sand = this.groundPoint(e.clientX, e.clientY);
    if (!sand) return;

    if (this.mode === "rake") {
      this.applyRake(this.rakeGuide.feed(sand.x, sand.z, this.rakeIslands()));
      return;
    }
    if (this.mode === "drag-stone" && this.dragId && inBounds(sand.x, sand.z, 0.7)) {
      this.stones.move(this.dragId, sand.x, sand.z);
      return;
    }
    if (this.mode === "drag-bonsai") {
      if (inBounds(sand.x, sand.z, 0.85)) {
        this.bonsaiState.x = sand.x;
        this.bonsaiState.z = sand.z;
        this.bonsai.setPose(sand.x, sand.z, this.bonsaiState.rotY);
      }
    }
  }

  private onUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.mode === "rake" || this.mode === "drag-stone" || this.mode === "drag-bonsai") {
      this.scheduleSave(true);
    } else if (this.mode === "orbit" || this.mode === "pan" || this.mode === "pinch") {
      this.scheduleSave();
    }
    this.mode = this.pointers.size >= 2 ? "pinch" : "idle";
    this.rakeGuide.reset();
    this.dragId = null;
    this.lastPointer = null;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }

  private tryPlaceStone(x: number, z: number): boolean {
    if (!inBounds(x, z, 0.75)) return false;
    for (const s of this.stones.stones) {
      if ((s.x - x) ** 2 + (s.z - z) ** 2 < 0.55) return false;
    }
    if ((this.bonsaiState.x - x) ** 2 + (this.bonsaiState.z - z) ** 2 < 1.05) return false;
    if ((this.basinState.x - x) ** 2 + (this.basinState.z - z) ** 2 < 0.95) return false;
    for (const l of this.lanternStates) {
      if ((l.x - x) ** 2 + (l.z - z) ** 2 < 0.7) return false;
    }
    const state: StoneState = {
      id: nextStoneId(this.stones.stones),
      x,
      z,
      rotY: Math.random() * Math.PI * 2,
      tiltX: (Math.random() - 0.5) * 0.36,
      tiltZ: (Math.random() - 0.5) * 0.28,
      scale: 0.7 + Math.random() * 0.45,
      variant: Math.floor(Math.random() * 12),
    };
    this.stones.add(state);
    this.scheduleSave(true);
    return true;
  }

  private blockers(): Blocker[] {
    const list: Blocker[] = [
      { x: this.bonsaiState.x, z: this.bonsaiState.z, r: 0.68 },
      { x: this.basinState.x, z: this.basinState.z, r: 0.58 },
    ];
    for (const l of this.lanternStates) list.push({ x: l.x, z: l.z, r: 0.4 });
    for (const s of this.stones.stones) list.push({ x: s.x, z: s.z, r: 0.32 + s.scale * 0.18 });
    for (const m of this.mossStates) list.push({ x: m.x, z: m.z, r: m.scale * 0.46 });
    return list;
  }

  private pick(cx: number, cy: number): {
    kind: string;
    x: number;
    z: number;
    id?: string;
    foliageId?: string;
  } | null {
    this.setNdc(cx, cy);
    this.raycaster.setFromCamera(this.ndc, this.cam.camera);
    const objects: THREE.Object3D[] = [
      this.sand.mesh,
      this.stones.group,
      this.bonsai.group,
    ];
    if (this.basinGroup) objects.push(this.basinGroup);
    if (this.mossGroup) objects.push(this.mossGroup);
    if (this.lanternGroup) objects.push(this.lanternGroup);
    const hits = this.raycaster.intersectObjects(objects, true);
    if (hits.length) {
      const obj = hits[0].object;
      let kind = obj.userData.kind as string | undefined;
      let cursor: THREE.Object3D | null = obj;
      while (!kind && cursor) {
        kind = cursor.userData.kind as string | undefined;
        cursor = cursor.parent;
      }
      const p = hits[0].point;
      return {
        kind: kind ?? "sand",
        x: p.x,
        z: p.z,
        id: obj.userData.id as string | undefined,
        foliageId: obj.userData.foliageId as string | undefined,
      };
    }
    const ground = this.groundPoint(cx, cy);
    if (!ground) return null;
    if (!inBounds(ground.x, ground.z, 0.05)) return null;
    return { kind: "sand", x: ground.x, z: ground.z };
  }

  private groundPoint(cx: number, cy: number): { x: number; z: number } | null {
    this.setNdc(cx, cy);
    this.raycaster.setFromCamera(this.ndc, this.cam.camera);
    if (this.raycaster.ray.intersectPlane(this.plane, this.hit)) {
      return { x: this.hit.x, z: this.hit.z };
    }
    return null;
  }

  private setNdc(cx: number, cy: number): void {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.x = ((cx - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((cy - rect.top) / rect.height) * 2 + 1;
  }

  private fingerDistance(): number {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  private persist(): void {
    const save: GardenSave = {
      v: 1,
      seed: this.seed,
      savedAt: Date.now(),
      sand: this.sand.exportDataUrl(),
      stones: this.stones.stones.map((s) => ({ ...s })),
      moss: this.mossStates.map((m) => ({ ...m })),
      basin: { ...this.basinState },
      bonsai: { ...this.bonsaiState, pruned: [...this.bonsaiState.pruned] },
      lanterns: this.lanternStates.map((l) => ({ ...l })),
      camera: this.cam.toState(),
    };
    if (writeSave(save)) this.ui.flashSaved();
  }

  private scheduleSave(immediate = false): void {
    window.clearTimeout(this.saveTimer);
    if (immediate) {
      this.persist();
      return;
    }
    this.saveTimer = window.setTimeout(() => this.persist(), 450);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.cam.setAspect(w / Math.max(1, h));
  }

  private tick = (): void => {
    if (this.disposed) return;
    requestAnimationFrame(this.tick);
    const dt = this.clock.getDelta();
    this.waterTime += dt;
    this.sand.flush();
    this.bonsai.update(performance.now(), this.clock.elapsedTime);
    if (this.basinGroup) updateWater(this.basinGroup, this.waterTime);
    if (this.lanternGroup) updateLanterns(this.lanternGroup, this.waterTime);
    this.renderer.render(this.scene, this.cam.camera);
  };

  private exposeApi(): void {
    const api: ZenGardenAPI = {
      ready: true,
      getSeed: () => this.seed,
      getTool: () => this.tool,
      setTool: (id) => this.setTool(id),
      getStoneCount: () => this.stones.stones.length,
      getStoneStats: () => this.stones.stats(),
      placeStoneAt: (x, z) => this.tryPlaceStone(x, z),
      getSave: () => loadSave(),
      newGarden: () => {
        this.plant(freshSeed());
        this.scheduleSave(true);
      },
      plantSeed: (seed) => {
        this.plant((seed >>> 0) || 1);
        this.scheduleSave(true);
      },
      getSeason: () => seasonFromBonsai(this.bonsaiState),
      getLanternCount: () => this.lanternStates.length,
      getFoliageCount: () => this.bonsai.foliage.size,
      waterBonsai: () => this.waterBonsai(),
      rakeFromTo: (x1, z1, x2, z2) => {
        this.sand.rake(x1, z1, x2, z2, this.blockers());
        this.sand.flush();
      },
      rakeStroke: (points) => this.playRakeStroke(points),
      sampleGrooveDeviation: (x1, z1, x2, z2) => this.sand.sampleGrooveDeviation(x1, z1, x2, z2),
      sampleArcDeviation: (cx, cz, radius, a0, a1) => this.sand.sampleArcDeviation(cx, cz, radius, a0, a1),
      getSandTone: () => this.sand.getSandTone(),
      getMossCount: () => this.mossStates.length,
    };
    window.__ZEN_GARDEN__ = api;
  }

  private playRakeStroke(points: Array<[number, number]>): RakeMode {
    if (points.length < 2) return "pending";
    const guide = new RakeGuide();
    guide.begin(points[0][0], points[0][1]);
    const islands = this.rakeIslands();
    for (let i = 1; i < points.length; i++) {
      this.applyRake(guide.feed(points[i][0], points[i][1], islands));
    }
    this.sand.flush();
    return guide.mode;
  }

  private applyRake(piece: RakePiece | null): void {
    if (!piece) return;
    const blockers = this.blockers();
    if (piece.kind === "arc") {
      this.sand.rakeArc(piece.cx, piece.cz, piece.radius, piece.a0, piece.a1, blockers);
      return;
    }
    this.sand.rake(piece.from.x, piece.from.z, piece.to.x, piece.to.z, blockers);
  }

  private rakeIslands(): RakeIsland[] {
    const by = new Map<number, StoneState[]>();
    for (const s of this.stones.stones) {
      if (s.cluster == null) continue;
      const list = by.get(s.cluster) ?? [];
      list.push(s);
      by.set(s.cluster, list);
    }
    const islands: RakeIsland[] = [];
    for (const members of by.values()) {
      const x = members.reduce((s, m) => s + m.x, 0) / members.length;
      const z = members.reduce((s, m) => s + m.z, 0) / members.length;
      const moss = this.mossStates.find((m) => Math.hypot(m.x - x, m.z - z) < 0.85);
      let reach = 0.35;
      for (const m of members) reach = Math.max(reach, Math.hypot(m.x - x, m.z - z) + m.scale * 0.22);
      const innerR = moss ? moss.scale * 0.48 : reach * 0.7;
      islands.push({ x, z, innerR, outerR: innerR + 2.35 });
    }
    return islands;
  }
}

declare global {
  interface Window {
    __ZEN_GARDEN__?: ZenGardenAPI;
  }
}
