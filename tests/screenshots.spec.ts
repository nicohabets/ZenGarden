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
    await page.evaluate(() => window.__ZEN_GARDEN__!.rakeFromTo(-4.1, 2.12, 3.5, 2.12));
    await page.waitForTimeout(1400);

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
