import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";

const outDir = "docs/screenshots";
/** Known layout: Ryoan-ji 15-stone groups on a pale gravel court. */
const SHOT_SEED = 3596739839;

test.describe("screenshots", () => {
  test.skip(!process.env.SHOTS, "set SHOTS=1 to capture PR images");

  test("nose-on gravel, island rings, and mobile close", async ({ page }) => {
    test.setTimeout(180_000);
    mkdirSync(outDir, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.waitForSelector('#app[data-game-ready="true"]');
    await page.waitForFunction(() => window.__ZEN_GARDEN__?.ready === true);
    await page.evaluate((seed) => window.__ZEN_GARDEN__!.plantSeed(seed), SHOT_SEED);
    await page.waitForFunction((seed) => window.__ZEN_GARDEN__?.getSeed() === seed, SHOT_SEED);

    const island = await page.evaluate(() => {
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
      return { cx, cz };
    });
    await page.waitForTimeout(1600);

    await page.evaluate(() => {
      window.__ZEN_GARDEN__!.setCamera({
        azimuth: 1.12,
        elevation: 0.21,
        zoom: 0.44,
        tx: -2.55,
        tz: 2.08,
      });
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${outDir}/gravel-close.png`, animations: "disabled" });

    await page.evaluate((look) => {
      window.__ZEN_GARDEN__!.setCamera({
        azimuth: 0.72,
        elevation: 0.3,
        zoom: 1.48,
        tx: look.cx + 0.18,
        tz: look.cz + 0.42,
      });
    }, island);
    await page.waitForTimeout(280);
    await page.screenshot({ path: `${outDir}/island-rings.png`, animations: "disabled" });
    await page.screenshot({ path: `${outDir}/desktop-isometric.png`, animations: "disabled" });
    await page.screenshot({ path: `${outDir}/ishi-gumi-desktop.png`, animations: "disabled" });

    await page.getByTestId("toolbar").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${outDir}/desktop-hud.png`, animations: "disabled" });
    await page.screenshot({ path: `${outDir}/ishi-gumi-hud.png`, animations: "disabled" });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate((look) => {
      window.__ZEN_GARDEN__!.setCamera({
        azimuth: 0.8,
        elevation: 0.28,
        zoom: 1.45,
        tx: look.cx + 0.18,
        tz: look.cz + 0.48,
      });
    }, island);
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${outDir}/mobile-close.png`, animations: "disabled" });
    await page.screenshot({ path: `${outDir}/mobile.png`, animations: "disabled" });
    await page.screenshot({ path: `${outDir}/ishi-gumi-mobile.png`, animations: "disabled" });
  });
});
