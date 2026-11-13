import { expect, type Page, test } from "@playwright/test";
import game from "../../../data/game.json" with { type: "json" };
import { indexJson, mockIndex, routeCases } from "./page-states";
import { answer, drawRecordedPath, puzzle } from "./recorded-play";

// Every state of every page, screenshotted per project for review by eye; the
// assertions only prove each state rendered before its picture was taken.
const DAY = new Date(`${game.launchDate}T12:00:00Z`);
const REVEAL_MS = 2_500;

test.use({ timezoneId: "UTC" });

test.beforeEach(async ({ page }, testInfo) => {
  await page.setViewportSize(
    testInfo.project.name === "desktop"
      ? { width: 1440, height: 900 }
      : { width: 390, height: 844 },
  );
  await page.clock.install({ time: DAY });
  await page.route("**/puzzles/*/puzzle.json", (route) => route.fulfill({ json: puzzle }));
  await page.route("**/puzzles/*/answer.json", (route) => route.fulfill({ json: answer }));
  await mockIndex(page, indexJson([]));
});

async function shoot(page: Page, state: string, fullPage = true) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: test.info().outputPath(`${state}.png`), fullPage });
}

async function openGame(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("slider", { name: /^Day \d$/u })).toHaveCount(7);
}

async function strokeHalfway(page: Page) {
  const box = await page.locator(".draw-region").boundingBox();
  if (!box) throw new Error("Missing drawing region.");
  const pointer = { pointerId: 7, pointerType: "touch", isPrimary: true, button: 0, buttons: 1 };
  const region = page.locator(".draw-region");
  const at = (fraction: number, rise: number) => ({
    clientX: box.x + 1 + box.width * fraction,
    clientY: box.y + box.height * (0.55 - rise),
  });
  await region.dispatchEvent("pointerdown", { ...pointer, ...at(0, 0) });
  for (const [fraction, rise] of [
    [0.1, 0.04],
    [0.2, 0.1],
    [0.3, 0.06],
    [0.42, 0.12],
  ] as const) {
    await region.dispatchEvent("pointermove", { ...pointer, ...at(fraction, rise) });
  }
}

test("the daily match in every state", async ({ page }) => {
  // Four reloads and a dozen full-page screenshots outrun the 30 s default on a hosted WebKit runner.
  test.slow();
  await openGame(page);
  await shoot(page, "daily-idle");

  await page.getByRole("slider", { name: "Day 1", exact: true }).focus();
  await shoot(page, "daily-keyboard");
  await page.getByRole("slider", { name: "Day 1", exact: true }).blur();

  await strokeHalfway(page);
  // The stroke paints on the next animation frame, which the installed clock holds.
  await page.clock.runFor(100);
  await shoot(page, "daily-drawing");

  await page.reload();
  await expect(page.getByRole("slider", { name: /^Day \d$/u })).toHaveCount(7);
  await drawRecordedPath(page);
  await shoot(page, "daily-drawn");

  await page.route("**/puzzles/*/answer.json", () => {});
  await page.getByRole("button", { name: "Hand it in", exact: true }).click();
  await shoot(page, "daily-locked");

  await page.unroute("**/puzzles/*/answer.json");
  await page.route("**/puzzles/*/answer.json", (route) => route.fulfill({ status: 404, body: "" }));
  await page.reload();
  await expect(page.getByRole("slider", { name: /^Day \d$/u })).toHaveCount(7);
  await drawRecordedPath(page);
  await page.getByRole("button", { name: "Hand it in", exact: true }).click();
  await expect(page.getByText("The answer did not load. Your drawing is kept.")).toBeVisible();
  await shoot(page, "daily-answer-error");

  await page.unroute("**/puzzles/*/answer.json");
  await page.route("**/puzzles/*/answer.json", (route) => route.fulfill({ json: answer }));
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.clock.runFor(REVEAL_MS);
  await expect(page.locator("#scoreline")).toHaveAttribute("data-reveal", "complete");
  await shoot(page, "daily-revealed");
  await shoot(page, "signature", false);

  await page.reload();
  await expect(page.locator("#scoreline")).toHaveAttribute("data-reveal", "complete");
  await shoot(page, "daily-returning");
});

test("an unpublished daily puzzle", async ({ page }) => {
  await page.route("**/puzzles/*/puzzle.json", (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/");
  await expect(page.getByText("Today's puzzle is not published yet.")).toBeVisible();
  await shoot(page, "daily-unpublished");
});

for (const route of routeCases) {
  test(`page: ${route.name}`, async ({ page }) => {
    await route.setup?.(page);
    await page.goto(`/${route.hash}`);
    await expect(route.ready(page)).toHaveCount(route.count ?? 1);
    await shoot(page, route.name.replaceAll(" ", "-"));
  });
}
