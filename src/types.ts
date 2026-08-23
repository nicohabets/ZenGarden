export type ToolId = "rake" | "stone" | "water" | "prune" | "place";
export type Season = "spring" | "summer" | "autumn" | "winter";

export interface StoneState {
  id: string;
  x: number;
  z: number;
  rotY: number;
  scale: number;
  variant: number;
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

export interface ZenGardenAPI {
  ready: boolean;
  getSeed(): number;
  getTool(): ToolId;
  setTool(id: ToolId): void;
  getStoneCount(): number;
  placeStoneAt(x: number, z: number): boolean;
  getSave(): GardenSave | null;
  newGarden(): void;
  getSeason(): Season;
  getLanternCount(): number;
  getFoliageCount(): number;
  waterBonsai(): Season;
}

export const GARDEN = {
  width: 12,
  depth: 9.6,
  sandY: 0.02,
} as const;

export const STORAGE_KEY = "zengarden.v1";
export const MUTE_KEY = "zengarden.muted";

export const TOOL_HINTS: Record<ToolId, string> = {
  rake: "Draw grooves through the sand",
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
