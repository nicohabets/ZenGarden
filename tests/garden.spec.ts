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
        [0, 2.35],
        [1.4, 2.2],
        [-1.2, 2.25],
        [2.15, -1.35],
        [-2.4, 2.1],
        [3.2, 2.4],
        [-3.1, -2.2],
        [0.8, 3.0],
      ];
      return spots.some(([x, z]) => api.placeStoneAt(x, z));
    });
    expect(placed).toBe(true);

    const afterPlace = await page.evaluate(() => {
      const api = window.__ZEN_GARDEN__!;
      const volume = api.getSandVolume();
      api.rakeFromTo(-2.4, 2.02, 2.3, 2.02);
      api.settleSand(16);
      return {
        stones: api.getStoneCount(),
        stored: window.localStorage.getItem("zengarden.v1"),
        trough: api.sampleHeight(0.1, 2.02),
        ridge: api.sampleHeight(0.1, 2.07),
        volumeBefore: volume,
        volumeAfter: api.getSandVolume(),
      };
    });
    expect(afterPlace.stones).toBe(before.stones + 1);
    expect(afterPlace.stored).toBeTruthy();
    expect(afterPlace.stored!).toContain(`"seed":${before.seed}`);
    expect(afterPlace.stored!).toMatch(/hf1r?:/);
    expect(afterPlace.trough).toBeLessThan(afterPlace.ridge);
    expect(Math.abs(afterPlace.volumeAfter - afterPlace.volumeBefore)).toBeLessThan(120);

    await page.reload();
    await waitForGarden(page);

    const restored = await page.evaluate(() => ({
      seed: window.__ZEN_GARDEN__!.getSeed(),
      stones: window.__ZEN_GARDEN__!.getStoneCount(),
      trough: window.__ZEN_GARDEN__!.sampleHeight(0.1, 2.02),
      packed: window.localStorage.getItem("zengarden.v1"),
    }));
    expect(restored.seed).toBe(before.seed);
    expect(restored.stones).toBe(before.stones + 1);
    expect(restored.packed).toMatch(/hf1r?:/);
    expect(restored.trough).toBeCloseTo(afterPlace.trough, 2);
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
    expect(start.foliage).toBeGreaterThan(18);
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

  test("stones cluster naturally and the bonsai is densely leaved", async ({ page }) => {
    await page.goto("/");
    await waitForGarden(page);

    const layout = await page.evaluate(() => {
      const api = window.__ZEN_GARDEN__!;
      const save = api.getSave();
      return {
        stats: api.getStoneStats(),
        foliage: api.getFoliageCount(),
        moss: api.getMossCount(),
        stones: save?.stones ?? [],
      };
    });

    expect(layout.stats.count).toBe(15);
    expect(layout.stats.clustered).toBe(15);
    expect(layout.stats.clusterSizes).toEqual([5, 3, 3, 3, 1]);
    expect(layout.stats.clusterSizes.every((n) => n % 2 === 1)).toBe(true);
    expect(layout.stats.tilted).toBeGreaterThanOrEqual(4);
    expect(layout.stats.minDist).toBeGreaterThan(0.55);
    expect(layout.stats.minDist).toBeLessThan(1.35);
    expect(layout.stats.scaleMax / Math.max(0.01, layout.stats.scaleMin)).toBeGreaterThan(1.35);
    expect(layout.foliage).toBeGreaterThan(18);
    expect(layout.moss).toBe(5);
    expect(layout.stones.some((s) => typeof s.tiltX === "number" && typeof s.tiltZ === "number")).toBe(true);
    expect(layout.stones.some((s) => s.cluster === 0)).toBe(true);

    const stored = await page.evaluate(() => window.localStorage.getItem("zengarden.v1"));
    expect(stored).toBeTruthy();
    expect(stored!).toContain('"tiltX"');
    expect(stored!).toContain('"cluster"');
  });

  test("gravel is pale and rake can curve, circle, or cut straight", async ({ page }) => {
    await page.goto("/");
    await waitForGarden(page);
    await page.evaluate(() => window.__ZEN_GARDEN__!.plantSeed(3596739839));
    await expect(page.getByTestId("mute-btn")).toHaveCount(0);

    const look = await page.evaluate(() => {
      const api = window.__ZEN_GARDEN__!;
      const save = api.getSave();
      const group = (save?.stones ?? []).filter((s) => s.cluster === 0);
      const cx = group.reduce((s, t) => s + t.x, 0) / group.length;
      const cz = group.reduce((s, t) => s + t.z, 0) / group.length;
      const moss = (save?.moss ?? []).find((m) => Math.hypot(m.x - cx, m.z - cz) < 0.85);
      const innerR = (moss?.scale ?? 1) * 0.48;
      const ringR = innerR + 0.165 * 2;
      return {
        tone: api.getSandTone(),
        ring: api.sampleArcDeviation(cx, cz, ringR),
        cx,
        cz,
        ringR,
      };
    });
    expect(look.tone.luma).toBeGreaterThan(150);
    expect(look.tone.r - look.tone.b).toBeLessThan(40);
    expect(look.ring).toBeLessThan(3.4);

    const curved = await page.evaluate(() => {
      const api = window.__ZEN_GARDEN__!;
      const pts: Array<[number, number]> = [];
      for (let i = 0; i <= 22; i++) {
        const a = Math.PI * 0.12 + (i / 22) * Math.PI * 0.85;
        pts.push([-1.7 + Math.cos(a) * 1.4, 2.32 + Math.sin(a) * 1.4]);
      }
      return {
        mode: api.rakeStroke(pts),
        alongArc: api.sampleArcDeviation(-1.7, 2.32, 1.4, Math.PI * 0.12, Math.PI * 0.97),
      };
    });
    expect(curved.mode).toBe("curve");
    expect(curved.alongArc).toBeLessThan(5.2);

    const circled = await page.evaluate((center) => {
      const api = window.__ZEN_GARDEN__!;
      const pts: Array<[number, number]> = [];
      const r = 1.22;
      for (let i = 0; i <= 30; i++) {
        const a = (i / 30) * Math.PI * 1.45;
        const jitter = Math.sin(i * 1.7) * 0.1;
        pts.push([center.cx + Math.cos(a) * (r + jitter), center.cz + Math.sin(a) * (r + jitter)]);
      }
      return {
        mode: api.rakeStroke(pts),
        round: api.sampleArcDeviation(center.cx, center.cz, r, 0, Math.PI * 1.4),
      };
    }, { cx: look.cx, cz: look.cz });
    expect(circled.mode).toBe("circle");
    expect(circled.round).toBeLessThan(3.2);

    const straight = await page.evaluate(() => {
      const api = window.__ZEN_GARDEN__!;
      const pts: Array<[number, number]> = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        pts.push([-3.4 + t * 6.4, 2.16 + Math.sin(t * 9) * 0.05]);
      }
      return {
        mode: api.rakeStroke(pts),
        line: api.sampleGrooveDeviation(-3.4, 2.16, 3.0, 2.16),
      };
    });
    expect(straight.mode).toBe("straight");
    expect(straight.line).toBeLessThan(2.4);

    const mass = await page.evaluate(() => {
      const api = window.__ZEN_GARDEN__!;
      const volume = api.getSandVolume();
      api.rakeFromTo(-3.2, -0.4, 3.1, -0.4);
      api.settleSand(20);
      return {
        trough: api.sampleHeight(0, -0.4),
        left: api.sampleHeight(0, -0.45),
        right: api.sampleHeight(0, -0.35),
        volume,
        after: api.getSandVolume(),
      };
    });
    expect(mass.trough).toBeLessThan(mass.left);
    expect(mass.trough).toBeLessThan(mass.right);
    expect(Math.abs(mass.after - mass.volume)).toBeLessThan(120);

    await page.getByTestId("tool-rake").click();
    await expect(page.getByTestId("hint")).toContainText(/circle a stone/i);
  });

  test("camera starts on the gravel and can zoom to grain scale", async ({ page }) => {
    await page.goto("/");
    await waitForGarden(page);

    const start = await page.evaluate(() => window.__ZEN_GARDEN__!.getCamera());
    expect(start.zoom).toBeLessThan(6);
    expect(start.elevation).toBeLessThan(0.55);

    await page.evaluate(() => {
      const api = window.__ZEN_GARDEN__!;
      for (let i = 0; i < 48; i++) api.dolly(-0.12);
    });
    const close = await page.evaluate(() => window.__ZEN_GARDEN__!.getCamera());
    expect(close.zoom).toBeLessThan(1);
    expect(close.zoom).toBeGreaterThan(0.3);

    await page.evaluate(() => {
      window.__ZEN_GARDEN__!.setCamera({ zoom: 0.72, elevation: 0.26, tx: 0.35, tz: -0.18 });
    });
    await page.waitForFunction(() => {
      const raw = window.localStorage.getItem("zengarden.v1");
      return !!raw && raw.includes('"zoom":');
    });

    await page.reload();
    await waitForGarden(page);
    const restored = await page.evaluate(() => window.__ZEN_GARDEN__!.getCamera());
    expect(restored.zoom).toBeCloseTo(0.72, 2);
    expect(restored.elevation).toBeCloseTo(0.26, 2);
    expect(restored.tx).toBeCloseTo(0.35, 2);
    expect(restored.tz).toBeCloseTo(-0.18, 2);
  });
});
