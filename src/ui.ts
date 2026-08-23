import { SEASON_LABEL, TOOL_HINTS, type Season, type ToolId } from "./types";

export class GardenUI {
  readonly toolbar: HTMLElement;
  readonly hint: HTMLElement;
  readonly muteBtn: HTMLButtonElement;
  readonly newBtn: HTMLButtonElement;
  readonly dialog: HTMLElement;
  readonly keepBtn: HTMLButtonElement;
  readonly beginBtn: HTMLButtonElement;
  readonly seedLabel: HTMLElement;
  readonly seasonLabel: HTMLElement;
  readonly saved: HTMLElement;
  readonly loading: HTMLElement;
  readonly app: HTMLElement;
  private saveTimer = 0;

  constructor() {
    this.app = must("#app");
    this.toolbar = must("#toolbar");
    this.hint = must("#hint");
    this.muteBtn = must<HTMLButtonElement>("#btn-mute");
    this.newBtn = must<HTMLButtonElement>("#btn-new");
    this.dialog = must("#new-dialog");
    this.keepBtn = must<HTMLButtonElement>("#btn-keep");
    this.beginBtn = must<HTMLButtonElement>("#btn-begin");
    this.seedLabel = must("#seed-label");
    this.seasonLabel = must("#season");
    this.saved = must("#saved");
    this.loading = must("#loading");
  }

  setTool(tool: ToolId): void {
    this.toolbar.dataset.toolActive = tool;
    for (const btn of this.toolbar.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
      btn.setAttribute("aria-pressed", btn.dataset.tool === tool ? "true" : "false");
    }
    this.hint.textContent = TOOL_HINTS[tool];
  }

  setMuted(muted: boolean): void {
    this.muteBtn.dataset.muted = muted ? "true" : "false";
    this.muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
    this.muteBtn.setAttribute("aria-label", muted ? "Unmute ambient sound" : "Mute ambient sound");
    this.muteBtn.querySelector(".mute-label")!.textContent = muted ? "Sound off" : "Sound on";
  }

  setSeed(seed: number): void {
    this.app.dataset.seed = String(seed);
    this.seedLabel.textContent = `seed ${seed}`;
  }

  setSeason(season: Season): void {
    this.seasonLabel.dataset.season = season;
    this.seasonLabel.textContent = SEASON_LABEL[season];
    this.app.dataset.season = season;
  }

  setReady(ok: boolean, webgl: boolean): void {
    this.app.dataset.gameReady = ok ? "true" : "false";
    this.app.dataset.webgl = webgl ? "ok" : "fail";
    this.loading.hidden = ok;
  }

  showNewDialog(open: boolean): void {
    this.dialog.hidden = !open;
    this.dialog.setAttribute("aria-hidden", open ? "false" : "true");
  }

  flashSaved(): void {
    this.saved.dataset.show = "true";
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.saved.dataset.show = "false";
    }, 1400);
  }

  onToolClick(handler: (tool: ToolId) => void): void {
    this.toolbar.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-tool]");
      if (!btn?.dataset.tool) return;
      handler(btn.dataset.tool as ToolId);
    });
  }
}

function must<T extends HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing ${sel}`);
  return el;
}
