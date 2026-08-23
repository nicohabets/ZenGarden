import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";

const outDir = "docs/screenshots";

test.describe("screenshots", () => {
  test.skip(!process.env.SHOTS, "set SHOTS=1 to capture PR images");

  test("desktop, hud, and mobile", async ({ page }) => {
    test.setTimeout(90_000);
    mkdirSync(outDir, { recursive: true });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.waitForSelector('#app[data-game-ready="true"]');
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${outDir}/desktop-isometric.png` });

    await page.getByTestId("toolbar").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${outDir}/desktop-hud.png` });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${outDir}/mobile.png` });
  });
});
