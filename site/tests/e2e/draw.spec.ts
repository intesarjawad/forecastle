import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import game from "../../../data/game.json" with { type: "json" };
import newYorkPuzzle from "../fixtures/2026-10-21/puzzle.json" with { type: "json" };
import { onSheet, regionBox } from "./recorded-play";

// The recording predates launch; only its calendar identity changes for the daily loader.
const puzzle = { ...newYorkPuzzle, id: game.launchDate, number: 1 };
const DRAG_VALUES = [23.6, 24.6, 25.6, 26.6, 27.6, 28.6, 29.6];
const TYPICAL_MOVE = 2.25925925925926;

test.use({ timezoneId: "UTC" });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${game.launchDate}T12:00:00Z`));
  await page.route("**/puzzles/*/puzzle.json", (route) => route.fulfill({ json: puzzle }));
  await page.goto("/");
  await expect(page.getByRole("slider", { name: /^Day \d$/u })).toHaveCount(7);
  await page.evaluate(() => document.fonts.ready);
});

test.afterEach(async ({ page }, testInfo) => {
  await testInfo.attach(`${testInfo.title}-${testInfo.project.name}`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

async function values(page: Page): Promise<number[]> {
  return page
    .getByRole("slider", { name: /^Day \d$/u })
    .evaluateAll((handles) =>
      handles.map((handle) => Number(handle.getAttribute("aria-valuenow"))),
    );
}

async function expectDrawn(page: Page, expected: readonly number[], tolerance = 0.000001) {
  await expect
    .poll(async () => {
      const actual = await values(page);
      return actual.every(
        (value, index) => Math.abs(value - (expected[index] ?? Infinity)) <= tolerance,
      );
    })
    .toBe(true);
  await expect(page.locator(".lesson")).toHaveClass(/\bhas-ink\b/u);
  await expect(page.locator(".your-prompt")).toBeHidden();
  await expect(page.locator(".draw-hint")).toBeEmpty();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

async function strokePoints(page: Page, from = 0, to = 7) {
  const region = await regionBox(page);
  // The recorded domain is [5.32, 32.68]. The drag rises by one degree per day.
  return Array.from({ length: 29 }, (_, index) => {
    const day = from + ((to - from) * index) / 28;
    const point = onSheet(region, day, 22.6 + day);
    return { x: point.x, y: point.y + (index === 0 && from === 0 ? 1 : 0) };
  });
}

async function mouseStroke(page: Page, from = 0, to = 7) {
  const points = await strokePoints(page, from, to);
  const first = points[0];
  if (!first) throw new Error("Missing stroke start.");
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(point.x, point.y);
  // Capture keeps the stroke active just beyond the last day, which clamps to +7.
  const last = points.at(-1);
  if (last && to === 7) await page.mouse.move(last.x, last.y + 1);
  await page.mouse.up();
}

test("a mouse drag makes seven daily values and a filled ink mark", async ({ page }) => {
  await mouseStroke(page);
  await expectDrawn(page, DRAG_VALUES, TYPICAL_MOVE);
});

test("a touch stroke makes seven daily values without scrolling the page", async ({ page }) => {
  const region = page.locator(".draw-region");
  expect(await region.evaluate((element) => getComputedStyle(element).touchAction)).toBe("none");
  const scrollY = await page.evaluate(() => window.scrollY);
  const points = await strokePoints(page);
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) throw new Error("Missing touch stroke endpoints.");
  const pointer = { pointerId: 42, pointerType: "touch", isPrimary: true, button: 0, buttons: 1 };
  await region.dispatchEvent("pointerdown", { ...pointer, clientX: first.x, clientY: first.y });
  for (const point of points.slice(1)) {
    await region.dispatchEvent("pointermove", { ...pointer, clientX: point.x, clientY: point.y });
  }
  await region.dispatchEvent("pointerup", {
    ...pointer,
    buttons: 0,
    clientX: last.x,
    clientY: last.y + 1,
  });
  await expectDrawn(page, DRAG_VALUES, TYPICAL_MOVE);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
});

test("the keyboard alone sets all seven days with a visible focus ring", async ({ page }) => {
  for (let day = 1; day <= 7; day += 1) {
    await page.keyboard.press("Tab");
    const handle = page.getByRole("slider", { name: `Day ${day}`, exact: true });
    await expect(handle).toBeFocused();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+ArrowUp");
    for (let step = 1; step < day; step += 1) await page.keyboard.press("ArrowUp");
    await expect(handle).toHaveAttribute("aria-valuetext", /°C$/);
    expect(await handle.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe("3px");
  }
  // 5.32 + 2 * (61/27), then successive half moves of 61/54.
  await expectDrawn(
    page,
    [
      9.8385185185, 10.9681481481, 12.0977777778, 13.2274074074, 14.357037037, 15.4866666667,
      16.6162962963,
    ],
  );
});

test("an incomplete mark stays visible and a second stroke finishes it", async ({ page }) => {
  await mouseStroke(page, 0, 3);
  await expect(page.locator(".draw-hint")).toHaveText("Keep drawing to +7.");
  await expect(page.locator(".lesson")).toHaveClass(/\bhas-ink\b/u);
  await mouseStroke(page, 3, 7);
  await expectDrawn(page, DRAG_VALUES, TYPICAL_MOVE);
});

test("the drawn card fits a 390 by 844 viewport and preserves values after resize", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mouseStroke(page);
  // Values land on the next animation frame, so wait for the drawn state before reading them.
  await expectDrawn(page, DRAG_VALUES, TYPICAL_MOVE);
  const before = await values(page);
  await page.setViewportSize({ width: 430, height: 844 });
  await expectDrawn(page, before);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectDrawn(page, before);
});
