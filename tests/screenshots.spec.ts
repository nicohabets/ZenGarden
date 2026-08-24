import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";

const outDir = process.env.SHOT_DIR || "docs/screenshots";
/** Known layout: Ryoan-ji 15-stone groups on a pale gravel court. */
const SHOT_SEED = 3596739839;

test.describe("screenshots", () => {
  test.skip(!process.env.SHOTS, "set SHOTS=1 to capture PR images");

  test("nose-on gravel, island rings, and mobile close", async ({ page }) => {
    test.setTimeout(600_000);
    mkdirSync(outDir, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/?hq=1");
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
      api.settleSand(3);
      return { cx, cz };
    });
    await page.waitForTimeout(400);

    await page.evaluate(() => {
      // Same grazing close-up, but on packed court — the island at the
      // end of this rake was the black void with a dotted grit rim.
      window.__ZEN_GARDEN__!.setCamera({
        azimuth: 1.52,
        elevation: 0.182,
        zoom: 0.38,
        tx: -1.85,
        tz: 1.88,
      });
    });
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${outDir}/gravel-close.png`, animations: "disabled" });

    await page.evaluate((look) => {
      window.__ZEN_GARDEN__!.setCamera({
        azimuth: 0.52,
        elevation: 0.48,
        zoom: 1.7,
        tx: look.cx + 0.05,
        tz: look.cz + 0.22,
      });
    }, island);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${outDir}/island-rings.png`, animations: "disabled" });

    await page.evaluate(() => {
      window.__ZEN_GARDEN__!.setCamera({
        azimuth: 0.78,
        elevation: 0.5,
        zoom: 3.7,
        tx: 0.15,
        tz: 0.12,
      });
    });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${outDir}/desktop-hud.png`, animations: "disabled" });

    await page.setViewportSize({ width: 390, height: 844 });
    // Packed court on the long rake, clear of every moss island.
    await page.evaluate(() => {
      window.__ZEN_GARDEN__!.setCamera({
        azimuth: 1.35,
        elevation: 0.5,
        zoom: 1.15,
        tx: -2.45,
        tz: 1.88,
      });
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${outDir}/mobile-close.png`, animations: "disabled" });
  });
});
