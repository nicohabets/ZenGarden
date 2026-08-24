import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";

const outDir = "docs/screenshots";
/** Known layout: Ryoan-ji 15-stone groups on a pale gravel court. */
const SHOT_SEED = 3596739839;

test.describe("screenshots", () => {
  test.skip(!process.env.SHOTS, "set SHOTS=1 to capture PR images");

  test("desktop, hud, and mobile", async ({ page }) => {
    test.setTimeout(90_000);
    mkdirSync(outDir, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.waitForSelector('#app[data-game-ready="true"]');
    await page.waitForFunction(() => window.__ZEN_GARDEN__?.ready === true);
    await page.evaluate((seed) => window.__ZEN_GARDEN__!.plantSeed(seed), SHOT_SEED);
    await page.waitForFunction((seed) => window.__ZEN_GARDEN__?.getSeed() === seed, SHOT_SEED);
    await page.evaluate(() => {
      const api = window.__ZEN_GARDEN__!;
      const save = api.getSave();
      const group = (save?.stones ?? []).filter((s) => s.cluster === 0);
      const cx = group.reduce((sum, s) => sum + s.x, 0) / Math.max(1, group.length);
      const cz = group.reduce((sum, s) => sum + s.z, 0) / Math.max(1, group.length);
      const ring: Array<[number, number]> = [];
      for (let i = 0; i <= 36; i++) {
        const a = (i / 36) * Math.PI * 2;
        ring.push([cx + Math.cos(a) * 1.28, cz + Math.sin(a) * 1.28]);
      }
      api.rakeStroke(ring);
      api.rakeFromTo(-5.1, 1.88, 4.6, 1.88);
    });
    await page.waitForTimeout(1600);

    const shots = [
      { path: `${outDir}/desktop-isometric.png` },
      { path: `${outDir}/ishi-gumi-desktop.png` },
    ];
    for (const shot of shots) {
      await page.screenshot({ path: shot.path, animations: "disabled" });
    }

    await page.getByTestId("toolbar").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${outDir}/desktop-hud.png`, animations: "disabled" });
    await page.screenshot({ path: `${outDir}/ishi-gumi-hud.png`, animations: "disabled" });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${outDir}/mobile.png`, animations: "disabled" });
    await page.screenshot({ path: `${outDir}/ishi-gumi-mobile.png`, animations: "disabled" });
  });
});
