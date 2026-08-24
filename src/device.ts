/** Shared capability flags so lighting, grid, and DPR stay in lockstep. */
export function isMobileGarden(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < 720 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
}

export function pixelRatioCap(): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.min(dpr, isMobileGarden() ? 1.5 : 1.75);
}

export function shadowsEnabled(): boolean {
  return !isMobileGarden();
}

export function chooseSimGrid(): { w: number; h: number } {
  if (isMobileGarden()) return { w: 128, h: 75 };
  return { w: 160, h: 94 };
}
