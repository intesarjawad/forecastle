import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type Page } from "@playwright/test";
import { createServer } from "vite";
import type { ChartPhase, FixtureId } from "../fixtures/chart-state";

// An isolated Vite server serves the fixture page only during tests. Production has no harness entry.
const test = base.extend<object, { chartOrigin: string }>({
  chartOrigin: [
    async ({ browserName: _browserName }, use) => {
      const server = await createServer({
        configFile: false,
        root: fileURLToPath(new URL("../../", import.meta.url)),
        server: { host: "127.0.0.1", port: 0, strictPort: true },
      });
      try {
        await server.listen();
        const origin = server.resolvedUrls?.local[0];
        if (!origin) throw new Error("The chart harness requires a local URL.");
        await use(origin);
      } finally {
        await server.close();
      }
    },
    { scope: "worker" },
  ],
});

const cases: readonly { id: FixtureId; state: ChartPhase; name: string }[] = [
  { id: "2026-10-21", state: "idle", name: "new-york-idle" },
  { id: "2026-10-21", state: "drawn", name: "new-york-drawn" },
  { id: "2026-10-21", state: "revealed", name: "new-york-revealed" },
  { id: "2026-10-22", state: "revealed", name: "stonehenge-revealed" },
];

async function openChart(page: Page, origin: string, id: FixtureId, state: ChartPhase) {
  await page.goto(new URL(`tests/fixtures/chart.html?id=${id}&state=${state}`, origin).href);
  await expect(page.locator(".chart-svg")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    for (const fixture of cases) {
      test(`${fixture.name} has no overflow or accessibility violations`, async ({
        page,
        chartOrigin,
      }, testInfo) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await openChart(page, chartOrigin, fixture.id, fixture.state);
        await testInfo.attach(`${fixture.name}-${viewport.width}x${viewport.height}`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: "image/png",
        });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        ).toBe(true);
        expect(await page.locator("table tbody tr").count()).toBe(28);
        const labels = await page.locator(".chart-end-label").evaluateAll((elements) =>
          elements.map((element) => {
            const box = element.getBoundingClientRect();
            return { top: box.top, bottom: box.bottom, center: (box.top + box.bottom) / 2 };
          }),
        );
        for (let index = 1; index < labels.length; index += 1) {
          const previous = labels[index - 1];
          const current = labels[index];
          if (!previous || !current) throw new Error("Missing endpoint label.");
          expect(current.center - previous.center).toBeGreaterThanOrEqual(23.99);
          expect(current.top).toBeGreaterThanOrEqual(previous.bottom);
        }
        expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
        expect(errors).toEqual([]);
      });

      test(`${fixture.name} @visual`, async ({ page, chartOrigin }) => {
        test.skip(process.platform !== "linux", "Visual baselines are recorded on Linux.");
        await openChart(page, chartOrigin, fixture.id, fixture.state);
        await expect(page).toHaveScreenshot(
          `${fixture.name}-${viewport.width}x${viewport.height}.png`,
          { fullPage: true },
        );
      });
    }
  });
}
