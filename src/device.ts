/** Shared capability flags so lighting, grid, and DPR stay in lockstep. */
export function isMobileGarden(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < 720 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
}

export function isSoftwareGL(gl?: WebGLRenderingContext | WebGL2RenderingContext | null): boolean {
  if (typeof navigator !== "undefined" && /HeadlessChrome/i.test(navigator.userAgent)) return true;
  if (!gl) return false;
  const ext = gl.getExtension("WEBGL_debug_renderer_info") as { UNMASKED_RENDERER_WEBGL: number } | null;
  const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
  return /SwiftShader|llvmpipe|Software|Microsoft Basic/i.test(name);
}

export function pixelRatioCap(software = false): number {
  const dpr = window.devicePixelRatio || 1;
  if (software) return 1;
  return Math.min(dpr, isMobileGarden() ? 1.5 : 1.5);
}

export function shadowsEnabled(software = false): boolean {
  if (software || isMobileGarden()) return false;
  return true;
}

export function chooseSimGrid(): { w: number; h: number } {
  if (isMobileGarden()) return { w: 128, h: 75 };
  return { w: 160, h: 94 };
}
