import { STORAGE_KEY, type GardenSave } from "./types";

export function loadSave(): GardenSave | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GardenSave;
    if (!parsed || parsed.v !== 1 || typeof parsed.seed !== "number") return null;
    if (!Array.isArray(parsed.stones) || !parsed.bonsai || !parsed.basin) return null;
    if (typeof parsed.sand !== "string") parsed.sand = "";
    return parsed;
  } catch {
    return null;
  }
}

export function writeSave(save: GardenSave): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
    return true;
  } catch {
    try {
      const slim: GardenSave = { ...save, sand: "" };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
      return true;
    } catch {
      return false;
    }
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore quota / private mode */
  }
}

