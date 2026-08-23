import { ZenGarden } from "./game";

const canvas = document.querySelector<HTMLCanvasElement>("#garden-canvas");
const app = document.querySelector<HTMLElement>("#app");

if (!canvas || !app) {
  throw new Error("Zen Garden markup is missing");
}

const root = app;

function fail(message: string): void {
  root.dataset.gameReady = "true";
  root.dataset.webgl = "fail";
  const loading = document.querySelector("#loading");
  if (loading) {
    loading.textContent = message;
    (loading as HTMLElement).hidden = false;
  }
}

try {
  const game = new ZenGarden(canvas);
  void game.start().catch(() => {
    fail("The garden could not be prepared.");
  });
} catch {
  fail("This browser cannot draw the garden (WebGL is unavailable).");
}
