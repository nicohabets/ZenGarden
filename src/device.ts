/** Shared capability flags so lighting, grid, and DPR stay in lockstep. */
export function isMobileGarden(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < 720 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
}

/** Screenshot / review path: skip the HeadlessChrome cheap-GL downgrade. */
export function wantHighQuality(): boolean {
  try {
    return typeof location !== "undefined" && new URLSearchParams(location.search).has("hq");
  } catch {
    return false;
  }
}

export function isSoftwareGL(gl?: WebGLRenderingContext | WebGL2RenderingContext | null): boolean {
  if (wantHighQuality()) return false;
  if (typeof navigator !== "undefined" && /HeadlessChrome/i.test(navigator.userAgent)) return true;
  if (!gl) return false;
  const ext = gl.getExtension("WEBGL_debug_renderer_info") as { UNMASKED_RENDERER_WEBGL: number } | null;
  const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
  return /SwiftShader|llvmpipe|Software|Microsoft Basic/i.test(name);
}

export function pixelRatioCap(software = false): number {
  const dpr = window.devicePixelRatio || 1;
  if (wantHighQuality()) return Math.min(Math.max(dpr, 1.5), 2);
  if (software) return 1;
  return Math.min(dpr, 1.5);
}

export function shadowsEnabled(software = false): boolean {
  if (software || isMobileGarden() || wantHighQuality()) return false;
  return true;
}

export function chooseSimGrid(): { w: number; h: number } {
  if (isMobileGarden()) return { w: 128, h: 75 };
  return { w: 160, h: 94 };
}

/** Display mesh only — sim grid stays cheap for rake / slump. */
export function chooseDisplayGrid(sim: { w: number; h: number }): { w: number; h: number } {
  if (wantHighQuality()) return { w: 320, h: 188 };
  if (isMobileGarden()) {
    return { w: Math.min(200, Math.round(sim.w * 1.5)), h: Math.min(118, Math.round(sim.h * 1.5)) };
  }
  return { w: Math.min(280, sim.w * 2), h: Math.min(164, sim.h * 2) };
}

