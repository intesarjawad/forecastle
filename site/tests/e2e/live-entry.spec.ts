import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import forecast from "../../../benchmark/fixtures/live/fixture/1/forecast.json" with {
  type: "json",
};
import chart1 from "../../../benchmark/fixtures/live/fixture/1/puzzle.json" with { type: "json" };
import chart2 from "../../../benchmark/fixtures/live/fixture/2/puzzle.json" with { type: "json" };
import chart3 from "../../../benchmark/fixtures/live/fixture/3/puzzle.json" with { type: "json" };
import game from "../../../data/game.json" with { type: "json" };
import constants from "../../../scoring/constants.json" with { type: "json" };
import { closeness, coverage } from "../../src/core/scoring";
import { verdict } from "../../src/core/verdict";
import { puzzle, regionBox } from "./recorded-play";

const ROUND = "live-2026-11-09";
const OPEN = new Date("2026-11-09T12:00:00Z");
const RESOLVED = new Date("2026-11-18T07:00:00Z");
const ACTUAL = [28, 29, 30, 31, 32, 33, 34];
const CROWD = {
  count: 10,
  median: [27.5, 28.5, 29.5, 30.5, 31.5, 32.5, 33.5],
  p10: [25, 26, 27, 28, 29, 30, 31],
  p90: [30, 31, 32, 33, 34, 35, 36],
};
const charts = [chart1, chart2, chart3].map((chart) => ({
  ...chart,
  id: `${ROUND}-${chart.number}`,
}));
const round = {
  id: ROUND,
  charts: 3,
  opensUtc: chart1.opensUtc,
  cutoffUtc: chart1.cutoffUtc,
  resolvesUtc: chart1.resolvesUtc,
};

test.use({ timezoneId: "UTC", locale: "en-US" });

/** Serve the fixture round to every page of the context and record what each page asks for. */
async function serveRound(context: BrowserContext, resolved: () => boolean) {
  const requests: string[] = [];
  context.on("request", (request) => requests.push(request.url()));
  await context.route("**/puzzles/index.json", (route) =>
    route.fulfill({
      json: {
        launchDate: game.launchDate,
        puzzles: [{ id: game.launchDate, number: 1, kind: "historical", label: puzzle.label }],
        live: [{ ...round, resolved: resolved() }],
      },
    }),
  );
  const chartFor = (url: string) => {
    const number = Number(new URL(url).pathname.split("/").at(-2));
    const found = charts.find((chart) => chart.number === number);
    if (!found) throw new Error(`No fixture for chart ${number}.`);
    return found;
  };
  await context.route(`**/live/${ROUND}/*/puzzle.json`, (route) =>
    route.fulfill({ json: chartFor(route.request().url()) }),
  );
  await context.route(`**/live/${ROUND}/*/forecast.json`, (route) =>
    route.fulfill({ json: forecast }),
  );
  await context.route(`**/live/${ROUND}/*/answer.json`, (route) =>
    route.fulfill({
      json: {
        id: chartFor(route.request().url()).id,
        dates: chart1.scoredDates,
        actual: ACTUAL,
        crowd: CROWD,
      },
    }),
  );
  return requests;
}

async function openLive(page: Page, at: Date) {
  await page.clock.install({ time: at });
  await page.goto("/#/live");
  await expect(page.locator(".live-card .chart-svg")).toHaveCount(3);
}

function card(page: Page, number: number): Locator {
  return page.locator(".live-card").nth(number - 1);
}

/** The page formats instants in the browser's own locale; WebKit and Chromium differ. */
async function instant(page: Page, iso: string): Promise<string> {
  return page.evaluate(
    (value) =>
      new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(value),
      ),
    iso,
  );
}

async function storedEntries(page: Page): Promise<unknown> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("forecastle.v1.live") ?? "null"));
}

/** Every day goes up one typical move, from 27 to 28, then the band widens one step. */
async function enterByKeyboard(page: Page, number: number) {
  const first = card(page, number).getByRole("slider", { name: "Day 1", exact: true });
  await first.focus();
  for (let day = 1; day <= 7; day += 1) {
    if (day > 1) await page.keyboard.press("Tab");
    await expect(card(page, number).getByRole("slider", { name: `Day ${day}` })).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
  }
  await page.keyboard.press("Tab");
  const band = card(page, number).getByRole("slider", { name: "How sure are you?" });
  await expect(band).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(band).toHaveAttribute("aria-valuetext", "±2.25 count");
  await page.keyboard.press("Tab");
  await expect(card(page, number).getByRole("button", { name: "Lock" })).toBeFocused();
  await page.keyboard.press("Enter");
}

test("an entry is drawn and locked by keyboard, survives a reload, and is scored at resolution", async ({
  page,
  context,
}) => {
  let resolved = false;
  const requests = await serveRound(context, () => resolved);
  await openLive(page, OPEN);
  await expect(page.getByRole("slider", { name: /^Day \d$/u })).toHaveCount(21);
  await expect(card(page, 1).getByRole("button", { name: "Lock" })).toBeDisabled();

  await enterByKeyboard(page, 1);
  const note = card(page, 1).locator(".live-note");
  await expect(note).toBeFocused();
  await expect(note).toHaveText(
    "This copy of the site has no entry service, so this entry stays on this device and is not counted.",
  );
  await expect(card(page, 1).locator(".draw-handle, .lock-button, .band-input")).toHaveCount(0);
  await expect(card(page, 1).locator(".chart-gesture")).toHaveCount(1);
  expect(await storedEntries(page)).toEqual([
    {
      schemaVersion: 1,
      puzzleId: `${ROUND}-1`,
      path: [28, 28, 28, 28, 28, 28, 28],
      halfWidth: 2.25,
      msToLock: expect.any(Number),
      status: "unserved",
    },
  ]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.reload();
  await expect(page.locator(".live-card .chart-svg")).toHaveCount(3);
  await expect(card(page, 1).locator(".chart-gesture")).toHaveCount(1);
  await expect(card(page, 1).locator(".draw-handle, .lock-button")).toHaveCount(0);
  await expect(card(page, 1).locator(".live-note")).toContainText("no entry service");
  await expect(card(page, 2).getByRole("slider", { name: /^Day \d$/u })).toHaveCount(7);
  await expect(card(page, 1).locator(".live-lock")).toHaveCount(1);
  expect(requests.filter((url) => /forecast\.json$|answer\.json$|\/v1\//u.test(url))).toEqual([]);

  resolved = true;
  const later = await context.newPage();
  await openLive(later, RESOLVED);
  await expect(later.locator(".chart-crowd")).toHaveCount(3);
  const path = Array(7).fill(28);
  const you = {
    closeness: closeness(path, ACTUAL, chart1.typicalMove, constants.k),
    coverage: coverage({ lower: Array(7).fill(25.75), upper: Array(7).fill(30.25) }, ACTUAL),
  };
  const ai = {
    closeness: closeness(forecast.median, ACTUAL, chart1.typicalMove, constants.k),
    coverage: coverage({ lower: forecast.q10, upper: forecast.q90 }, ACTUAL),
  };
  await expect(card(later, 1).locator(".live-result")).toHaveText(
    `You ${you.closeness}, model ${ai.closeness}. ${verdict(you, ai)}. Your band caught ${you.coverage} of 7 days.`,
  );
  await expect(card(later, 1).locator(".chart-gesture")).toHaveCount(1);
  await expect(card(later, 2).locator(".chart-gesture, .live-result")).toHaveCount(0);
  await expect(later.locator(".draw-handle, .lock-button")).toHaveCount(0);
  expect((await new AxeBuilder({ page: later }).analyze()).violations).toEqual([]);
});

test("a pointer stroke after the gap enables the lock", async ({ page, context }) => {
  await serveRound(context, () => false);
  await openLive(page, OPEN);
  await card(page, 2).locator(".chart-svg").scrollIntoViewIfNeeded();
  const region = await regionBox(page, card(page, 2).locator(".draw-region"));
  if (!region) throw new Error("Missing drawing region.");
  const y = region.y + region.height / 2;
  await page.mouse.move(region.x + 1, y);
  await page.mouse.down();
  for (let step = 1; step <= 14; step += 1)
    await page.mouse.move(region.x + (region.width * step) / 14, y);
  await page.mouse.move(region.x + region.width + 1, y);
  await page.mouse.up();
  const lock = card(page, 2).getByRole("button", { name: "Lock" });
  await expect(lock).toBeEnabled();
  await lock.click();
  await expect(card(page, 2).locator(".chart-gesture")).toHaveCount(1);
  expect(await storedEntries(page)).toEqual([
    expect.objectContaining({ puzzleId: `${ROUND}-2`, status: "unserved" }),
  ]);
});

test("a round that closes while the player draws refuses the lock and stores nothing", async ({
  page,
  context,
}) => {
  await serveRound(context, () => false);
  await openLive(page, new Date(Date.parse(chart1.cutoffUtc) - 2_000));
  const first = card(page, 1).getByRole("slider", { name: "Day 1", exact: true });
  await first.focus();
  await page.keyboard.press("ArrowUp");
  await page.clock.fastForward(5_000);
  await card(page, 1).getByRole("button", { name: "Lock" }).click();
  await expect(card(page, 1).locator(".live-note")).toContainText(
    `Entries for this round closed at ${await instant(page, chart1.cutoffUtc)}. It resolves ${await instant(page, chart1.resolvesUtc)}.`,
  );
  await expect(card(page, 1).locator(".draw-handle, .lock-button")).toHaveCount(0);
  expect(await storedEntries(page)).toBeNull();
  await card(page, 1).getByRole("button", { name: "Play today's puzzle" }).click();
  await expect(page).toHaveURL(/#\/$/u);
});

test("an entry the Worker holds shows as locked with the sealed forecast's hash and proof", async ({
  page,
  context,
}) => {
  await serveRound(context, () => false);
  await page.addInitScript((puzzleId) => {
    localStorage.setItem(
      "forecastle.v1.live",
      JSON.stringify([
        {
          schemaVersion: 1,
          puzzleId,
          path: [28, 28, 28, 28, 28, 28, 28],
          halfWidth: 1,
          msToLock: 9000,
          status: "sent",
        },
      ]),
    );
  }, `${ROUND}-3`);
  await openLive(page, OPEN);
  await expect(card(page, 3).locator(".live-note")).toHaveText(
    `Locked. The AI forecast was sealed ${await instant(page, chart3.opensUtc)} and is revealed when entries close. The round resolves ${await instant(page, chart3.resolvesUtc)}.`,
  );
  await expect(card(page, 3).locator(".live-commit a").first()).toHaveText(
    chart3.forecastSha256.slice(0, 12),
  );
  await expect(card(page, 3).getByRole("link", { name: "OpenTimestamps proof" })).toBeVisible();
  await expect(card(page, 3).locator(".draw-handle, .lock-button")).toHaveCount(0);
  await expect(card(page, 1).getByRole("slider", { name: /^Day \d$/u })).toHaveCount(7);
});

function seedEntries(page: Page, entries: readonly object[]) {
  return page.addInitScript((records) => {
    localStorage.setItem("forecastle.v1.live", JSON.stringify(records));
  }, entries);
}

const unsent = {
  schemaVersion: 1,
  puzzleId: `${ROUND}-2`,
  path: [28, 28, 28, 28, 28, 28, 28],
  halfWidth: 1,
  msToLock: 9000,
  status: "unsent",
};

test("an unsent entry is sent again when the page opens before the cutoff", async ({
  page,
  context,
}) => {
  await serveRound(context, () => false);
  await seedEntries(page, [unsent]);
  await openLive(page, OPEN);
  // This build has no Worker, so the attempt ends as "unserved"; a deployed one answers.
  await expect(card(page, 2).locator(".live-note")).toHaveText(
    "This copy of the site has no entry service, so this entry stays on this device and is not counted.",
  );
  expect(await storedEntries(page)).toEqual([{ ...unsent, status: "unserved" }]);
});

test("an unsent entry is not sent once the round has closed", async ({ page, context }) => {
  await serveRound(context, () => false);
  await seedEntries(page, [unsent]);
  await openLive(page, new Date(Date.parse(chart1.cutoffUtc) + 1_000));
  await expect(card(page, 2).locator(".live-note")).toHaveText(
    "This entry did not reach the entry service before the round closed, so it is not counted.",
  );
  expect(await storedEntries(page)).toEqual([unsent]);
});

test("a stroke that stops short names the live chart's own last day", async ({ page, context }) => {
  await serveRound(context, () => false);
  await openLive(page, OPEN);
  await card(page, 1).locator(".chart-svg").scrollIntoViewIfNeeded();
  await expect(card(page, 1).locator(".chart-svg text", { hasText: /^\+10$/u })).toHaveCount(1);
  const region = await regionBox(page, card(page, 1).locator(".draw-region"));
  if (!region) throw new Error("Missing drawing region.");
  const y = region.y + region.height / 2;
  await page.mouse.move(region.x + 1, y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1)
    await page.mouse.move(region.x + (region.width * step) / 10, y);
  await page.mouse.up();
  await expect(card(page, 1).locator(".draw-hint")).toHaveText("Keep drawing to +10.");
  await expect(card(page, 1).getByRole("button", { name: "Lock" })).toBeDisabled();
});

test("live entries round-trip through the history download with their status", async ({
  page,
  browser,
}) => {
  const records = {
    plays: [
      {
        schemaVersion: 1,
        puzzleId: "2026-11-19",
        kind: "daily",
        playedOn: "2026-11-19",
        path: [1, 2, 3, 4, 5, 6, 7],
        halfWidth: 1,
        closeness: 61,
        aiCloseness: 48,
        coverage: 5,
        stats: null,
      },
    ],
    live: [{ ...unsent, puzzleId: `${ROUND}-1`, status: "sent" }, unsent],
  };
  await page.goto("/#/data");
  await page.evaluate(({ plays, live }) => {
    localStorage.setItem("forecastle.v1.plays", JSON.stringify(plays));
    localStorage.setItem("forecastle.v1.live", JSON.stringify(live));
  }, records);
  await page.reload();
  await expect(page.locator(".history-list li")).toHaveText([
    /2026-11-19, daily, played 2026-11-19: You 61, AI 48/u,
    `Live entry ${ROUND}-1: sent`,
    `Live entry ${ROUND}-2: not sent yet`,
  ]);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download my history", exact: true }).click(),
  ]);
  const file = await download.path();

  const fresh = await browser.newContext();
  const restoredPage = await fresh.newPage();
  await restoredPage.goto("/#/data");
  await expect(restoredPage.getByText("No plays are saved on this device yet.")).toBeVisible();
  await restoredPage.getByLabel("Restore from a file").setInputFiles(file);
  await expect(restoredPage.locator(".data-status")).toHaveText(
    "Restored 1 play and 2 live entries.",
  );
  await expect(restoredPage.locator(".history-list li")).toHaveCount(3);
  const stored = await restoredPage.evaluate(() => ({
    plays: JSON.parse(localStorage.getItem("forecastle.v1.plays") ?? "null"),
    live: JSON.parse(localStorage.getItem("forecastle.v1.live") ?? "null"),
  }));
  expect(stored).toEqual(records);
  await fresh.close();
});
