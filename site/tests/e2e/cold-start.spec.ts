import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import game from "../../../data/game.json" with { type: "json" };
import recordedAnswer from "../fixtures/2026-10-21/answer.json" with { type: "json" };
import recordedPuzzle from "../fixtures/2026-10-21/puzzle.json" with { type: "json" };
import { onSheet } from "./recorded-play";

const puzzle = { ...recordedPuzzle, id: game.launchDate, number: 1 };
const answer = { ...recordedAnswer, id: game.launchDate };
const INTERACTIVE_BUDGET_MS = 2_500;
const REVEAL_BUDGET_MS = 2_500;
const DOWNLOAD_BYTES_PER_SECOND = 200_000;
const UPLOAD_BYTES_PER_SECOND = 93_750;
const LATENCY_MS = 150;
const CPU_SLOWDOWN = 4;
const NOW = Date.parse(`${game.launchDate}T12:00:00Z`);
// A straight rise of one degree per day from the last visible value.
// One value per day boundary from today to +7, so the stroke covers all seven days.
const STROKE_VALUES = [22.6, 23.6, 24.6, 25.6, 26.6, 27.6, 28.6, 29.6];

type InteractiveMoment = {
  interactiveMs: number;
  hitIsDrawTarget: boolean;
  hit: string | null;
  dialogOpen: boolean;
  indexRequested: boolean;
};

test("the first puzzle is interactive and reveals within budget on a cold start", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "CDP throttling is Chromium-only.");
  if (!baseURL) throw new Error("Missing baseURL.");

  const context = await browser.newContext({
    baseURL,
    timezoneId: "UTC",
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    storageState: { cookies: [], origins: [] },
  });
  try {
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      downloadThroughput: DOWNLOAD_BYTES_PER_SECOND,
      uploadThroughput: UPLOAD_BYTES_PER_SECOND,
      latency: LATENCY_MS,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });

    // Only the calendar is fixed; the Performance API must stay real for the budgets.
    await page.addInitScript(`{ const Real = Date; Date = class extends Real {
      constructor(...args) { super(...(args.length ? args : [${NOW}])); }
    }; }`);

    await page.route("**/puzzles/*/puzzle.json", (route) => route.fulfill({ json: puzzle }));
    await page.route("**/puzzles/*/answer.json", (route) => route.fulfill({ json: answer }));

    const indexRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/puzzles/index.json")) indexRequests.push(request.url());
    });

    await page.goto(baseURL);
    const handle = await page.waitForFunction(
      () => {
        const mark = performance.getEntriesByName("forecastle:interactive", "mark").at(-1);
        const region = document.querySelector(".draw-region");
        if (!mark || !region) return null;
        const box = region.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return {
          interactiveMs: mark.startTime,
          hitIsDrawTarget: hit === region,
          hit: hit ? `${hit.tagName}.${hit.getAttribute("class") ?? ""}` : null,
          dialogOpen: document.querySelector("dialog[open]") !== null,
          indexRequested: performance
            .getEntriesByType("resource")
            .some((entry) => entry.name.endsWith("/puzzles/index.json")),
        };
      },
      null,
      { timeout: 15_000 },
    );
    const moment = (await handle.jsonValue()) as InteractiveMoment;

    expect(moment.interactiveMs).toBeLessThanOrEqual(INTERACTIVE_BUDGET_MS);
    expect(moment.hitIsDrawTarget, `Centre of the hidden region hit ${moment.hit}.`).toBe(true);
    expect(moment.dialogOpen).toBe(false);
    expect(moment.indexRequested).toBe(false);

    const region = await page.locator(".draw-region").boundingBox();
    if (!region) throw new Error("Missing drawing region.");
    const [lower, upper] = puzzle.yDomain;
    if (lower === undefined || upper === undefined) throw new Error("Missing draw domain.");
    const points = STROKE_VALUES.map((value, day) => {
      const point = onSheet(region, day, value, [lower, upper]);
      return { x: point.x, y: point.y + (day === 0 ? 1 : 0) };
    });
    const first = points[0];
    const last = points.at(-1);
    if (!first || !last) throw new Error("Missing stroke endpoints.");
    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    for (const point of points.slice(1)) await page.mouse.move(point.x, point.y);
    await page.mouse.move(last.x, last.y + 1);
    await page.mouse.up();

    const lock = page.getByRole("button", { name: "Hand it in", exact: true });
    await expect(lock).toBeEnabled();

    await page.evaluate(() => {
      const scoreline = document.getElementById("scoreline");
      if (!scoreline) throw new Error("Missing scoreline.");
      const observer = new MutationObserver(() => {
        if (scoreline.dataset.reveal !== "complete") return;
        performance.mark("cold-start:reveal-complete");
        observer.disconnect();
      });
      observer.observe(scoreline, { attributes: true, attributeFilter: ["data-reveal"] });
    });
    const response = page.waitForResponse((candidate) => candidate.url().endsWith("/answer.json"));
    await lock.click();
    expect((await response).ok()).toBe(true);
    await expect(page.locator("#scoreline")).toHaveAttribute("data-reveal", "complete", {
      timeout: 10_000,
    });

    const marks = await page.evaluate(() => {
      const arrival = performance.getEntriesByName("forecastle-answer-arrival", "mark").at(-1);
      const complete = performance.getEntriesByName("cold-start:reveal-complete", "mark").at(-1);
      return { arrival: arrival?.startTime ?? null, complete: complete?.startTime ?? null };
    });
    if (marks.arrival === null || marks.complete === null)
      throw new Error("Missing reveal timings.");
    const revealMs = marks.complete - marks.arrival;

    const file = join(testInfo.config.rootDir, "test-results", "cold-start.json");
    await mkdir(join(testInfo.config.rootDir, "test-results"), { recursive: true });
    await writeFile(
      file,
      `${JSON.stringify(
        {
          url: baseURL,
          project: testInfo.project.name,
          downloadBitsPerSecond: DOWNLOAD_BYTES_PER_SECOND * 8,
          uploadBitsPerSecond: UPLOAD_BYTES_PER_SECOND * 8,
          latencyMs: LATENCY_MS,
          cpuThrottlingRate: CPU_SLOWDOWN,
          interactiveMs: moment.interactiveMs,
          answerToRevealMs: revealMs,
          indexRequests: indexRequests.length,
        },
        null,
        2,
      )}\n`,
    );

    expect(revealMs).toBeLessThanOrEqual(REVEAL_BUDGET_MS);
    expect(indexRequests).toEqual([]);
  } finally {
    await context.close();
  }
});
