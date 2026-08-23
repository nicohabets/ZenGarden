import { expect, test, type Page } from "@playwright/test";

async function waitForGarden(page: Page): Promise<void> {
  await page.waitForSelector('#app[data-game-ready="true"]', { timeout: 20_000 });
  await page.waitForFunction(() => window.__ZEN_GARDEN__?.ready === true, null, {
    timeout: 20_000,
  });
}

test.describe("Zen Garden", () => {
  test("app loads and the garden canvas renders", async ({ page }) => {
    await page.goto("/");
    await waitForGarden(page);

    await expect(page.locator("h1")).toHaveText(/zen garden/i);
    const canvas = page.getByTestId("garden-canvas");
    await expect(canvas).toBeVisible();

    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThan(200);
    expect(box!.height).toBeGreaterThan(200);

    const webgl = await page.locator("#app").getAttribute("data-webgl");
    expect(webgl).toBe("ok");

    const pixels = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>("#garden-canvas");
      if (!canvas) return 0;
      return canvas.width * canvas.height;
    });
    expect(pixels).toBeGreaterThan(10_000);
  });

  test("toolbar is visible and a tool can be selected", async ({ page }) => {
    await page.goto("/");
    await waitForGarden(page);

    const toolbar = page.getByTestId("toolbar");
    await expect(toolbar).toBeVisible();
    await expect(toolbar).toHaveAttribute("data-tool-active", "rake");

    await page.getByTestId("tool-water").click();
    await expect(toolbar).toHaveAttribute("data-tool-active", "water");
    await expect(page.getByTestId("hint")).toContainText(/bonsai/i);

    const tool = await page.evaluate(() => window.__ZEN_GARDEN__!.getTool());
    expect(tool).toBe("water");

    await page.getByTestId("tool-stone").click();
    await expect(toolbar).toHaveAttribute("data-tool-active", "stone");
  });

  test("persist and reload keeps the garden", async ({ page }) => {
    await page.goto("/");
    await waitForGarden(page);

    const before = await page.evaluate(() => ({
      seed: window.__ZEN_GARDEN__!.getSeed(),
      stones: window.__ZEN_GARDEN__!.getStoneCount(),
    }));
    expect(before.seed).toBeGreaterThan(0);
    expect(Number.isInteger(before.seed)).toBe(true);
    expect(before.stones).toBeGreaterThan(0);

    const placed = await page.evaluate(() => {
      const api = window.__ZEN_GARDEN__!;
      const spots: Array<[number, number]> = [
        [2.15, -1.35],
        [-2.4, 2.1],
        [3.2, 2.4],
        [-3.1, -2.2],
        [0.8, 3.0],
        [-0.6, -3.1],
        [1.6, 1.8],
        [-1.8, -0.4],
      ];
      return spots.some(([x, z]) => api.placeStoneAt(x, z));
    });
    expect(placed).toBe(true);

    const afterPlace = await page.evaluate(() => ({
      stones: window.__ZEN_GARDEN__!.getStoneCount(),
      stored: window.localStorage.getItem("zengarden.v1"),
    }));
    expect(afterPlace.stones).toBe(before.stones + 1);
    expect(afterPlace.stored).toBeTruthy();
    expect(afterPlace.stored!).toContain(`"seed":${before.seed}`);

    await page.reload();
    await waitForGarden(page);

    const restored = await page.evaluate(() => ({
      seed: window.__ZEN_GARDEN__!.getSeed(),
      stones: window.__ZEN_GARDEN__!.getStoneCount(),
    }));
    expect(restored.seed).toBe(before.seed);
    expect(restored.stones).toBe(before.stones + 1);
  });

  test("new garden dialog can keep the current garden", async ({ page }) => {
    await page.goto("/");
    await waitForGarden(page);
    const seed = await page.evaluate(() => window.__ZEN_GARDEN__!.getSeed());

    await page.getByTestId("new-garden-btn").click();
    await expect(page.getByTestId("new-dialog")).toBeVisible();
    await page.getByTestId("keep-garden-btn").click();
    await expect(page.getByTestId("new-dialog")).toBeHidden();

    const still = await page.evaluate(() => window.__ZEN_GARDEN__!.getSeed());
    expect(still).toBe(seed);
  });

  test("mobile viewport smoke", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await waitForGarden(page);

    const toolbar = page.getByTestId("toolbar");
    await expect(toolbar).toBeVisible();
    const box = await toolbar.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.height).toBeGreaterThan(56);
    expect(box!.width).toBeGreaterThan(240);
    expect(box!.y + box!.height).toBeLessThan(844 + 1);

    await page.getByTestId("tool-prune").click();
    await expect(toolbar).toHaveAttribute("data-tool-active", "prune");
    await expect(page.getByTestId("garden-canvas")).toBeVisible();
    await expect(page.getByTestId("season")).toBeVisible();
  });

  test("lanterns, season, and watering are visible and persist", async ({ page }) => {
    await page.goto("/");
    await waitForGarden(page);

    const start = await page.evaluate(() => ({
      lanterns: window.__ZEN_GARDEN__!.getLanternCount(),
      foliage: window.__ZEN_GARDEN__!.getFoliageCount(),
      season: window.__ZEN_GARDEN__!.getSeason(),
    }));
    expect(start.lanterns).toBeGreaterThan(0);
    expect(start.foliage).toBeGreaterThan(5);
    expect(["spring", "summer", "autumn", "winter"]).toContain(start.season);
    await expect(page.getByTestId("season")).toHaveAttribute("data-season", start.season);

    await page.getByTestId("tool-water").click();
    const afterWater = await page.evaluate(() => {
      let season = window.__ZEN_GARDEN__!.getSeason();
      for (let i = 0; i < 3; i++) season = window.__ZEN_GARDEN__!.waterBonsai();
      return {
        season,
        lanterns: window.__ZEN_GARDEN__!.getLanternCount(),
      };
    });
    expect(afterWater.season).toBe("summer");
    await expect(page.getByTestId("season")).toHaveAttribute("data-season", "summer");

    await page.reload();
    await waitForGarden(page);
    const restored = await page.evaluate(() => ({
      season: window.__ZEN_GARDEN__!.getSeason(),
      lanterns: window.__ZEN_GARDEN__!.getLanternCount(),
    }));
    expect(restored.season).toBe("summer");
    expect(restored.lanterns).toBe(afterWater.lanterns);
  });
});
