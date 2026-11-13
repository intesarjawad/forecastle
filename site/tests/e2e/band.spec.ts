import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import game from "../../../data/game.json" with { type: "json" };
import newYorkPuzzle from "../fixtures/2026-10-21/puzzle.json" with { type: "json" };
import { onSheet, regionBox } from "./recorded-play";

const puzzle = { ...newYorkPuzzle, id: game.launchDate, number: 1 };
const { typicalMove, unit } = puzzle;

test.use({ timezoneId: "UTC" });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${game.launchDate}T12:00:00Z`));
  await page.route("**/puzzles/*/puzzle.json", (route) => route.fulfill({ json: puzzle }));
  await page.goto("/");
  await expect(page.getByRole("slider", { name: /^Day \d$/u })).toHaveCount(7);
  await page.evaluate(() => document.fonts.ready);
});

async function drawStroke(page: Page) {
  const region = await regionBox(page);
  const at = (day: number) => {
    const point = onSheet(region, day, 22.6 + day);
    return { x: point.x, y: point.y + (day === 0 ? 1 : 0) };
  };
  await page.mouse.move(at(0).x, at(0).y);
  await page.mouse.down();
  for (let index = 1; index <= 28; index += 1) {
    const point = at(index / 4);
    await page.mouse.move(point.x, point.y);
  }
  await page.mouse.move(at(7).x, at(7).y + 1);
  await page.mouse.up();
  await expect(slider(page)).toBeVisible();
}

// The band is the width of the wash the brush lays, which the sumi layer records.
async function extentAtDay7(page: Page): Promise<number> {
  const wash = await page.locator(".ink-layer[data-wash]").getAttribute("data-wash");
  if (wash === null) throw new Error("Missing the wash width.");
  return Number(wash);
}

const slider = (page: Page) => page.getByRole("slider", { name: "How sure are you?" });

test("the slider appears only after a stroke, labelled and with its helper text", async ({
  page,
}) => {
  await expect(slider(page)).toHaveCount(0);
  await drawStroke(page);
  await expect(slider(page)).toBeVisible();
  await expect(page.getByText("More sure")).toBeVisible();
  await expect(page.getByText("Less sure")).toBeVisible();
  await expect(page.getByText("Aim to catch about 8 days in 10")).toBeVisible();
  const box = await slider(page).boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("doubling the multiplier doubles the band and the value text states its half-width", async ({
  page,
}) => {
  await drawStroke(page);
  const one = await extentAtDay7(page);
  await expect(slider(page)).toHaveAttribute(
    "aria-valuetext",
    `±${Number((2 * typicalMove).toFixed(2))} ${unit}`,
  );
  await slider(page).fill("4");
  await expect
    .poll(async () => Math.abs((await extentAtDay7(page)) - 2 * one))
    .toBeLessThanOrEqual(1);
  await expect(slider(page)).toHaveAttribute(
    "aria-valuetext",
    `±${Number((4 * typicalMove).toFixed(2))} ${unit}`,
  );
});

test("arrow keys move the slider one step", async ({ page }) => {
  await drawStroke(page);
  await slider(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect(slider(page)).toHaveValue("2.25");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(slider(page)).toHaveValue("1.75");
});

test("the drawn card has no overflow at 390 by 844 and no axe violations", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await drawStroke(page);
  await expect(slider(page)).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
