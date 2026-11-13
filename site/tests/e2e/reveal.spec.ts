import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import game from "../../../data/game.json" with { type: "json" };
import { answer, drawRecordedPath, expected, puzzle } from "./recorded-play";

const MODEL_ELEMENTS = ".sheet-copy-band, .sheet-copy-line, .sheet-copy-day, .mark-key";
// The player's ink is painted, not drawn as SVG, so a locked drawing is compared by the ink
// laid in the player's column. Canvases round semi-transparent pixels differently when one is
// carried across a resize, so the comparison allows a small difference.
const sumi = (page: Page) =>
  page.locator(".ink-layer:not(.ink-shu):not(.ink-gl):not(.ink-marks)").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const column = document.querySelector('[data-col="you"]')?.getBoundingClientRect();
    if (!column) throw new Error("Missing the player's column.");
    const sheet = canvas.getBoundingClientRect();
    const ratio = canvas.width / sheet.width;
    const pixels = canvas
      .getContext("2d")
      ?.getImageData(
        Math.round((column.left - sheet.left) * ratio),
        Math.round((column.top - sheet.top) * ratio),
        Math.round(column.width * ratio),
        Math.round(column.height * ratio),
      ).data;
    if (!pixels) throw new Error("Missing the ink layer.");
    let laid = 0;
    for (let index = 3; index < pixels.length; index += 4) laid += pixels[index] ?? 0;
    return laid / 255;
  });
const same = (a: number, b: number) => Math.abs(a - b) <= a * 0.01;

test.use({ timezoneId: "UTC" });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${game.launchDate}T12:00:00Z`));
  await page.route("**/puzzles/*/puzzle.json", (route) => route.fulfill({ json: puzzle }));
  await page.route("**/puzzles/*/answer.json", (route) => route.fulfill({ json: answer }));
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

async function expectFinal(page: Page) {
  await expect(page.locator("#scoreline")).toHaveAttribute("data-reveal", "complete");
  await expect(page.locator("#you-score")).toHaveText(String(expected.you.closeness));
  await expect(page.locator("#ai-score")).toHaveText(String(expected.ai.closeness));
  await expect(page.locator(".result-stamp")).toHaveText("You beat the AI by 30 points");
  await expect(page.locator(".result-reason")).toHaveText(
    `Closer overall, ${expected.you.closeness} to ${expected.ai.closeness} (100 is exact)`,
  );
  await expect(page.locator(".day-cell")).toHaveCount(14);
  for (const [row, result] of [expected.you, expected.ai].entries()) {
    const cells = page.locator(".day-cells").nth(row).locator(".day-cell");
    for (const [index, colour] of result.cells.entries()) {
      await expect(cells.nth(index)).toHaveClass(`day-cell cell-${colour}`);
      await expect(cells.nth(index)).toHaveText("");
      expect(await cells.nth(index).evaluate((cell) => getComputedStyle(cell).opacity)).toBe("1");
    }
  }
  await expect(page.getByRole("link", { name: "How scoring works" })).toHaveAttribute(
    "href",
    "#/how",
  );
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();
  await expect(page.getByRole("slider")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Hand it in", exact: true })).toHaveCount(0);
}

test("the answer and model stay hidden until a complete drawing is locked", async ({ page }) => {
  let requests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/answer.json")) requests += 1;
  });
  await expect(page.getByRole("button", { name: "Hand it in", exact: true })).toBeDisabled();
  await expect(page.locator(MODEL_ELEMENTS)).toHaveCount(0);
  await drawRecordedPath(page);
  await expect(page.locator(MODEL_ELEMENTS)).toHaveCount(0);
  expect(requests).toBe(0);
  expect(
    await page.evaluate(() =>
      performance.getEntriesByType("resource").some((entry) => entry.name.endsWith("/answer.json")),
    ),
  ).toBe(false);
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/puzzles/*/answer.json", async (route) => {
    await held;
    await route.fulfill({ json: answer });
  });
  const path = await sumi(page);
  await page.getByRole("button", { name: "Hand it in", exact: true }).click();
  await expect(page.getByRole("slider", { name: /^Day \d$/u })).toHaveCount(0);
  await expect(page.getByRole("slider", { name: "How sure are you?" })).toBeDisabled();
  await expect(page.locator(".draw-region")).toHaveCount(0);
  expect(same(await sumi(page), path)).toBe(true);
  expect(requests).toBe(1);
  release();
  await expectFinal(page);
});

test("the finished phone card contains the match and announces it once", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await drawRecordedPath(page);
  await page.evaluate(() => {
    const live = document.getElementById("match-live");
    if (!live) throw new Error("Missing live region.");
    live.dataset.announcements = "0";
    new MutationObserver(() => {
      live.dataset.announcements = String(Number(live.dataset.announcements) + 1);
    }).observe(live, { childList: true });
  });
  await page.getByRole("button", { name: "Hand it in", exact: true }).click();
  await expectFinal(page);
  const live = page.locator('[aria-live="polite"]');
  await expect(live).toHaveText(
    "You 85, AI 55. You beat the AI by 30 points. Closer overall, 85 to 55 (100 is exact).",
  );
  await expect(live).toHaveAttribute("data-announcements", "1");
  // The day marks sit on the points of these two columns.
  for (const selector of [
    ".body-you",
    ".body-ai",
    "#you-score",
    "#ai-score",
    ".result-stamp",
    ".result-reason",
    ".share-button",
  ]) {
    const box = await page.locator(selector).boundingBox();
    if (!box) throw new Error(`Missing ${selector}.`);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.y + box.height).toBeLessThanOrEqual(844);
  }
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const heads = page.locator(".column-head").filter({ visible: true });
  await expect(page.locator("#series-dates")).toHaveText("30 Apr to 3 Jun 2026");
  expect((await heads.allTextContents()).join(" ")).not.toMatch(/−21 d|−14 d|−7 d|Jun/u);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

// A fixed clock replaces the Performance API, so the timing runs in its own context with only
// the calendar date pinned.
test("the last cell lands within 2.5 s of the answer", async ({ browser, baseURL }) => {
  if (!baseURL) throw new Error("Missing baseURL.");
  const context = await browser.newContext({ baseURL, timezoneId: "UTC" });
  const page = await context.newPage();
  const now = Date.parse(`${game.launchDate}T12:00:00Z`);
  await page.addInitScript(
    `{ const Real = Date; Date = class extends Real {
      constructor(...args) { super(...(args.length ? args : [${now}])); }
      static now() { return ${now}; }
    }; }`,
  );
  await page.route("**/puzzles/*/puzzle.json", (route) => route.fulfill({ json: puzzle }));
  await page.route("**/puzzles/*/answer.json", (route) => route.fulfill({ json: answer }));
  await page.goto("/");
  await expect(page.getByRole("slider", { name: /^Day \d$/u })).toHaveCount(7);
  await drawRecordedPath(page);
  await page.getByRole("button", { name: "Hand it in", exact: true }).click();
  await expect(page.locator("#scoreline")).toHaveAttribute("data-reveal", "complete");
  const duration = await page.evaluate(
    () =>
      performance.getEntriesByName("forecastle-answer-to-last-cell", "measure").at(-1)?.duration,
  );
  expect(duration).toBeDefined();
  expect(duration).toBeLessThan(2500);
  await context.close();
});

test("reduced motion prints the final result in the first observed result frame", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await drawRecordedPath(page);
  await page.evaluate(() => {
    const scoreline = document.getElementById("scoreline");
    if (!scoreline) throw new Error("Missing scoreline.");
    const observer = new MutationObserver(() => {
      if (!scoreline.querySelector(".result-stamp")) return;
      scoreline.dataset.firstFrame = JSON.stringify({
        you: document.getElementById("you-score")?.textContent,
        ai: document.getElementById("ai-score")?.textContent,
        complete: scoreline.dataset.reveal,
        cells: Array.from(
          scoreline.querySelectorAll(".day-cell"),
          (cell) => getComputedStyle(cell).opacity,
        ),
        stamp: getComputedStyle(scoreline.querySelector(".result-stamp") ?? scoreline).opacity,
      });
      observer.disconnect();
    });
    observer.observe(scoreline, { childList: true, subtree: true });
  });
  await page.getByRole("button", { name: "Hand it in", exact: true }).click();
  await expectFinal(page);
  const first = await page.locator("#scoreline").getAttribute("data-first-frame");
  expect(JSON.parse(first ?? "null")).toEqual({
    you: String(expected.you.closeness),
    ai: String(expected.ai.closeness),
    complete: "complete",
    cells: Array.from({ length: 14 }, () => "1"),
    stamp: "1",
  });
  // The teacher's vermilion is already on the sheet, not still being written.
  expect(
    await page.locator(".ink-shu").evaluate((canvas) => {
      const blank = document.createElement("canvas");
      blank.width = (canvas as HTMLCanvasElement).width;
      blank.height = (canvas as HTMLCanvasElement).height;
      return (canvas as HTMLCanvasElement).toDataURL() !== blank.toDataURL();
    }),
  ).toBe(true);
});

test("a failed answer can be retried without changing the locked drawing", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await drawRecordedPath(page);
  const path = await sumi(page);
  await page.route("**/puzzles/*/answer.json", (route) => route.abort(), { times: 1 });
  await page.getByRole("button", { name: "Hand it in", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(
    "The answer did not load. Your drawing is kept.",
  );
  expect(same(await sumi(page), path)).toBe(true);
  await expect(page.locator(".draw-region, .draw-handle")).toHaveCount(0);
  await expect(page.locator(MODEL_ELEMENTS)).toHaveCount(0);
  await page.getByRole("button", { name: "Try again" }).click();
  await expectFinal(page);
  const ink = await sumi(page);
  await page.setViewportSize({ width: 430, height: 844 });
  await expect(page.locator(".draw-region, .draw-handle")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  // Returning to the same geometry repaints the locked path exactly and keeps both final scores.
  await expect.poll(async () => same(await sumi(page), ink)).toBe(true);
  await expectFinal(page);
});
