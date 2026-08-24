export type ToolId = "rake" | "stone" | "water" | "prune" | "place";
export type Season = "spring" | "summer" | "autumn" | "winter";

export interface StoneState {
  id: string;
  x: number;
  z: number;
  rotY: number;
  scale: number;
  variant: number;
  tiltX?: number;
  tiltZ?: number;
  cluster?: number;
}

export interface MossState {
  id: string;
  x: number;
  z: number;
  rotY: number;
  scale: number;
}

export interface BasinState {
  x: number;
  z: number;
  rotY: number;
}

export interface LanternState {
  id: string;
  x: number;
  z: number;
  rotY: number;
}

export interface BonsaiState {
  x: number;
  z: number;
  rotY: number;
  pruned: string[];
  lastWatered: number;
  wateredCount: number;
}

export interface CameraState {
  azimuth: number;
  elevation: number;
  zoom: number;
  tx: number;
  tz: number;
}

export interface GardenSave {
  v: 1;
  seed: number;
  savedAt: number;
  sand: string;
  stones: StoneState[];
  moss: MossState[];
  basin: BasinState;
  bonsai: BonsaiState;
  lanterns?: LanternState[];
  camera: CameraState;
}

export interface GeneratedWorld {
  seed: number;
  stones: StoneState[];
  moss: MossState[];
  basin: BasinState;
  bonsai: BonsaiState;
  lanterns: LanternState[];
}

export interface Blocker {
  x: number;
  z: number;
  r: number;
}

export interface StoneStats {
  count: number;
  minDist: number;
  scaleMin: number;
  scaleMax: number;
  tilted: number;
  clustered: number;
  clusterSizes: number[];
}

export interface SandTone {
  r: number;
  g: number;
  b: number;
  luma: number;
}

export interface ZenGardenAPI {
  ready: boolean;
  getSeed(): number;
  getTool(): ToolId;
  setTool(id: ToolId): void;
  getStoneCount(): number;
  getStoneStats(): StoneStats;
  placeStoneAt(x: number, z: number): boolean;
  getSave(): GardenSave | null;
  newGarden(): void;
  plantSeed(seed: number): void;
  getSeason(): Season;
  getLanternCount(): number;
  getFoliageCount(): number;
  waterBonsai(): Season;
  rakeFromTo(x1: number, z1: number, x2: number, z2: number): void;
  rakeStroke(points: Array<[number, number]>): RakeMode;
  sampleGrooveDeviation(x1: number, z1: number, x2: number, z2: number): number;
  sampleArcDeviation(cx: number, cz: number, radius: number, a0?: number, a1?: number): number;
  sampleHeight(x: number, z: number): number;
  getSandVolume(): number;
  settleSand(steps?: number): void;
  getSandTone(): SandTone;
  getMossCount(): number;
  getCamera(): CameraState;
  setCamera(state: Partial<CameraState>): void;
  dolly(delta: number): void;
}

export const GARDEN = {
  width: 14,
  depth: 8.2,
  sandY: 0.02,
} as const;

export type RakeMode = "pending" | "circle" | "straight" | "curve";

export const STORAGE_KEY = "zengarden.v1";

export const TOOL_HINTS: Record<ToolId, string> = {
  rake: "Draw grooves, or circle a stone",
  stone: "Tap empty sand to place · drag a stone to move",
  water: "Water the bonsai — it grows, and the season turns",
  prune: "Tap foliage to prune",
  place: "Drag the bonsai pot to a new resting place",
};

export const SEASON_LABEL: Record<Season, string> = {
  spring: "春",
  summer: "夏",
  autumn: "秋",
  winter: "冬",
};

export function seasonFromBonsai(b: BonsaiState, now = Date.now()): Season {
  const hours = Math.max(0, (now - b.lastWatered) / 3_600_000);
  if (hours >= 36) return "winter";
  if (hours >= 10) return "autumn";
  if (b.wateredCount >= 3) return "summer";
  return "spring";
}
