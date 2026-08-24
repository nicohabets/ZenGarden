import * as THREE from "three";
import { Bonsai } from "./bonsai";
import { CameraRig } from "./camera";
import { isMobileGarden, isSoftwareGL, pixelRatioCap, shadowsEnabled, wantHighQuality } from "./device";
import { generateWorld, inBounds, nextStoneId } from "./generate";
import { FrameMeter } from "./perf";
import { loadSave, writeSave } from "./persistence";
import { RakeGuide, type RakeIsland, type RakePiece } from "./rake";
import { GrainBed } from "./grains";
import { SandField } from "./sand";
import {
  createApron,
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
  GARDEN,
  seasonFromBonsai,
  type BasinState,
  type Blocker,
  type BonsaiState,
  type GardenSave,
  type LanternState,
  type MossState,
  type RakeMode,
  type StoneState,
  type PerfStats,
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
  private readonly grains: GrainBed;
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
  private readonly startedAt = performance.now();
  private readonly meter = new FrameMeter();
  private readonly softwareGL: boolean;
  private readonly useShadows: boolean;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const probeCanvas = document.createElement("canvas");
    const probe = probeCanvas.getContext("webgl2") ?? probeCanvas.getContext("webgl");
    this.softwareGL = isSoftwareGL(probe);
    this.useShadows = shadowsEnabled(this.softwareGL);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: wantHighQuality() || (!isMobileGarden() && !this.softwareGL),
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(pixelRatioCap(this.softwareGL));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = this.useShadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = wantHighQuality() ? 1.32 : 1.26;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.background = new THREE.Color(0xddd6c8);
    this.scene.fog = new THREE.Fog(0xddd6c8, 24, 56);

    this.sand = new SandField();
    this.grains = new GrainBed((x, z) => this.sand.sampleHeight(x, z), this.softwareGL);
    this.seed = freshSeed();

    this.lights();
    this.scene.add(createGround());
    this.scene.add(createApron());
    this.scene.add(createFrame());
    this.scene.add(createBackdrop());
    this.scene.add(this.sand.mesh);
    this.scene.add(this.grains.group);
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
    this.meter.markReady(this.startedAt);
    this.ui.setReady(true, true);
    this.publishPerf();
    this.exposeApi();
    this.tick();
  }

  flushSave(): void {
    this.persist();
  }

  private plant(seed: number): void {
    const t0 = performance.now();
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
    this.sand.embedOccupants(this.occupants());
    this.sand.settle(12);
    this.sand.flush();
    this.grains.setBlockers(this.blockers());
    this.grains.rebuild();
    this.grains.followLook(this.cam.target.x, this.cam.target.z, this.cam.zoom, this.cam.elevation, this.cam.aspect);
    this.settleOccupants();
    this.meter.plantMs = performance.now() - t0;
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
    this.sand.flush();
    this.grains.setBlockers(this.blockers());
    this.grains.rebuild();
    this.grains.followLook(this.cam.target.x, this.cam.target.z, this.cam.zoom, this.cam.elevation, this.cam.aspect);
    this.settleOccupants();
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
    const hemi = new THREE.HemisphereLight(0xfff6ea, 0x8a8478, 0.92);
    this.scene.add(hemi);
    const fill = new THREE.AmbientLight(0xf2ebe0, 0.34);
    this.scene.add(fill);
    const bounce = new THREE.DirectionalLight(0xe8e4dc, 0.48);
    bounce.position.set(-9.2, 6.4, -5.4);
    bounce.castShadow = false;
    this.scene.add(bounce);
    const sun = new THREE.DirectionalLight(0xfff3e2, 1.18);
    sun.position.set(16.8, 4.4, 7.2);
    sun.castShadow = this.useShadows;
    if (this.useShadows) {
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.camera.near = 2;
      sun.shadow.camera.far = 40;
      sun.shadow.camera.left = -11;
      sun.shadow.camera.right = 11;
      sun.shadow.camera.top = 9;
      sun.shadow.camera.bottom = -9;
      sun.shadow.bias = -0.0005;
      sun.shadow.normalBias = 0.04;
    }
    this.scene.add(sun);
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
        this.cam.dolly(e.deltaY > 0 ? 0.07 : -0.07);
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
      this.stones.move(this.dragId, sand.x, sand.z, this.sand.sampleHeight(sand.x, sand.z));
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
    if (this.mode === "rake") {
      this.sand.queueSlump(6);
      this.scheduleSave(true);
    } else if (this.mode === "drag-stone") {
      if (this.dragId) {
        const s = this.stones.get(this.dragId);
        if (s) this.sand.bankObject(s.x, s.z, 0.28 + s.scale * 0.2, 0.016, 0.018);
        this.grains.setBlockers(this.blockers());
      }
      this.sand.queueSlump(4);
      this.scheduleSave(true);
    } else if (this.mode === "drag-bonsai") {
      this.sand.bankObject(this.bonsaiState.x, this.bonsaiState.z, 0.58, 0.014, 0.016);
      this.sand.queueSlump(3);
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
    this.grains.setBlockers(this.blockers());
    this.sand.bankObject(x, z, 0.28 + state.scale * 0.2, 0.016, 0.018);
    this.sand.queueSlump(3);
    this.scheduleSave(true);
    return true;
  }

  private occupants(): { x: number; z: number; r: number; pile?: number; sink?: number }[] {
    const list = [
      ...this.stones.stones.map((s) => ({ x: s.x, z: s.z, r: 0.28 + s.scale * 0.2 })),
      ...this.mossStates.map((m) => ({ x: m.x, z: m.z, r: m.scale * 0.52, pile: 0.02, sink: 0.018 })),
      { x: this.basinState.x, z: this.basinState.z, r: 0.52 },
      { x: this.bonsaiState.x, z: this.bonsaiState.z, r: 0.6 },
      ...this.lanternStates.map((l) => ({ x: l.x, z: l.z, r: 0.22 })),
    ];
    return list;
  }

  private settleOccupants(): void {
    this.stones.settleToSand((x, z) => this.sand.sampleHeight(x, z));
    if (this.mossGroup) {
      for (const child of this.mossGroup.children) {
        child.position.y = GARDEN.sandY + this.sand.sampleHeight(child.position.x, child.position.z) - 0.05;
      }
    }
    if (this.bonsai) {
      this.bonsai.group.position.y = GARDEN.sandY + this.sand.sampleHeight(this.bonsaiState.x, this.bonsaiState.z) - 0.01;
    }
    if (this.basinGroup) {
      this.basinGroup.position.y = GARDEN.sandY + this.sand.sampleHeight(this.basinState.x, this.basinState.z) - 0.01;
    }
    if (this.lanternGroup) {
      for (const child of this.lanternGroup.children) {
        child.position.y = GARDEN.sandY + this.sand.sampleHeight(child.position.x, child.position.z) - 0.008;
      }
    }
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
    this.renderer.setPixelRatio(pixelRatioCap(this.softwareGL));
    this.renderer.setSize(w, h, false);
    this.cam.setAspect(w / Math.max(1, h));
  }

  private tick = (): void => {
    if (this.disposed) return;
    requestAnimationFrame(this.tick);
    const dt = this.clock.getDelta();
    this.waterTime += dt;
    this.sand.stepSlump(dt);
    if (this.sand.consumeOccupantSettle()) this.settleOccupants();
    const packed = this.sand.flush();
    if (packed) this.grains.syncRegion(this.sand.dirtyWorld());
    this.grains.followLook(this.cam.target.x, this.cam.target.z, this.cam.zoom, this.cam.elevation, this.cam.aspect);
    this.bonsai.update(performance.now(), this.clock.elapsedTime);
    if (this.basinGroup) updateWater(this.basinGroup, this.waterTime);
    if (this.lanternGroup) updateLanterns(this.lanternGroup, this.waterTime);
    this.renderer.render(this.scene, this.cam.camera);
    this.meter.sample();
    if (this.meter.shouldPublish()) this.publishPerf();
  };

  private publishPerf(): void {
    const stats = this.meter.stats(this.sand.simW, this.sand.simH, this.useShadows);
    const app = this.ui.app;
    app.dataset.fps = stats.fps.toFixed(0);
    app.dataset.frameMs = stats.avgFrameMs.toFixed(1);
    app.dataset.readyMs = String(Math.round(stats.readyMs));
  }

  private readPerf(): PerfStats {
    return this.meter.stats(this.sand.simW, this.sand.simH, this.useShadows);
  }

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
        this.grains.syncRegion(this.sand.dirtyWorld());
        this.scheduleSave(true);
      },
      rakeStroke: (points) => this.playRakeStroke(points),
      sampleGrooveDeviation: (x1, z1, x2, z2) => this.sand.sampleGrooveDeviation(x1, z1, x2, z2),
      sampleArcDeviation: (cx, cz, radius, a0, a1) => this.sand.sampleArcDeviation(cx, cz, radius, a0, a1),
      sampleHeight: (x, z) => this.sand.sampleHeight(x, z),
      getSandVolume: () => this.sand.getSandVolume(),
      settleSand: (steps) => {
        this.sand.settle(steps ?? 8);
        this.sand.flush();
        this.grains.syncRegion(this.sand.dirtyWorld());
        this.settleOccupants();
        this.scheduleSave(true);
      },
      getSandTone: () => this.sand.getSandTone(),
      getGrainCount: () => this.grains.getCount(),
      getPerf: () => this.readPerf(),
      getMossCount: () => this.mossStates.length,
      getCamera: () => this.cam.toState(),
      setCamera: (state) => {
        const cur = this.cam.toState();
        this.cam.applyState({
          azimuth: state.azimuth ?? cur.azimuth,
          elevation: state.elevation ?? cur.elevation,
          zoom: state.zoom ?? cur.zoom,
          tx: state.tx ?? cur.tx,
          tz: state.tz ?? cur.tz,
        });
        this.grains.followLook(this.cam.target.x, this.cam.target.z, this.cam.zoom, this.cam.elevation, this.cam.aspect);
        this.scheduleSave(true);
      },
      dolly: (delta) => {
        this.cam.dolly(delta);
        this.grains.followLook(this.cam.target.x, this.cam.target.z, this.cam.zoom, this.cam.elevation, this.cam.aspect);
        this.scheduleSave();
      },
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
    this.sand.settle(4);
    this.sand.flush();
    this.grains.syncRegion(this.sand.dirtyWorld());
    this.settleOccupants();
    this.scheduleSave(true);
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
