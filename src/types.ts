export type ToolId = "rake" | "stone" | "water" | "prune" | "place";

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
  camera: CameraState;
}

export interface GeneratedWorld {
  seed: number;
  stones: StoneState[];
  moss: MossState[];
  basin: BasinState;
  bonsai: BonsaiState;
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
  water: "Water the bonsai",
  prune: "Tap foliage to prune",
  place: "Drag the bonsai pot to a new resting place",
};
