import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import game from "../../../data/game.json" with { type: "json" };
import { indexJson, mockLive } from "./page-states";
import { puzzle } from "./recorded-play";

const launch = Date.parse(`${game.launchDate}T12:00:00Z`);
const tomorrow = new Date(launch + 86_400_000).toISOString().slice(0, 10);
const play = {
  schemaVersion: 1,
  puzzleId: puzzle.id,
  kind: "daily",
  playedOn: puzzle.id,
  path: [1, 2, 3, 4, 5, 6, 7],
  halfWidth: 1,
  closeness: 61,
  aiCloseness: 48,
  coverage: 5,
  stats: null,
};

test.use({ timezoneId: "UTC" });
async function shoot(page: Page, state: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: test.info().outputPath(`${state}.png`) });
}

test.beforeEach(async ({ page }, testInfo) => {
  await page.setViewportSize(
    testInfo.project.name === "desktop"
      ? { width: 1440, height: 900 }
      : { width: 390, height: 844 },
  );
  await page.clock.install({ time: new Date(launch) });
  await page.route("**/puzzles/*/puzzle.json", (route) => {
    const id = route.request().url().split("/").at(-2);
    return route.fulfill({
      json: { ...puzzle, id, label: id === tomorrow ? "Tomorrow's chart" : puzzle.label },
    });
  });
  await page.route("**/puzzles/index.json", (route) => route.fulfill({ json: indexJson([]) }));
});

test("invalid saved dates leave valid plays and the game usable", async ({ page }) => {
  await page.addInitScript(
    (saved) =>
      localStorage.setItem(
        "forecastle.v1.plays",
        JSON.stringify([{ ...saved, puzzleId: "corrupt", playedOn: "2026-99-99" }, saved]),
      ),
    play,
  );
  await page.goto("/#/data");
  await expect(page.locator(".history-list li")).toHaveCount(1);
  await shoot(page, "corrupt-storage-survivor");
  await page.getByRole("link", { name: "Today", exact: true }).click();
  await expect(page.locator("#series-name")).toHaveText(puzzle.label);
});

test("invalid route and restore dates report failure without a crash", async ({ page }) => {
  await page.goto("/#/p/2026-99-99");
  await expect(page.getByText("That page does not exist.")).toBeVisible();
  await shoot(page, "invalid-route");
  await page.goto("/#/data");
  await page.locator("#restore-file").setInputFiles({
    name: "history.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify([{ ...play, playedOn: "2026-99-99" }])),
  });
  await expect(page.getByText("That file is not a Forecastle history file.")).toBeVisible();
  await shoot(page, "invalid-import");
});

for (const resume of ["navigation", "focus", "visibilitychange", "pageshow"] as const) {
  test(`an overnight tab loads today's puzzle on ${resume}`, async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#series-name")).toHaveText(puzzle.label);
    if (resume === "navigation")
      await page.getByRole("link", { name: "Scoring", exact: true }).click();
    await page.clock.setSystemTime(new Date(launch + 86_400_000));
    if (resume === "navigation")
      await page.getByRole("link", { name: "Today", exact: true }).click();
    else
      await page.evaluate(
        (event) =>
          (event === "visibilitychange" ? document : window).dispatchEvent(new Event(event)),
        resume,
      );
    await expect(page.locator("#series-name")).toHaveText("Tomorrow's chart");
    await shoot(page, "overnight");
  });
}

test("loading hides drawing instructions until the chart arrives", async ({ page }) => {
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/puzzles/*/puzzle.json", async (route) => {
    await pending;
    await route.fulfill({ json: puzzle });
  });
  await page.goto("/");
  await expect(
    page.getByRole("status", { name: "" }).filter({ hasText: "Loading puzzle" }),
  ).toBeVisible();
  await expect(page.locator(".your-prompt")).toBeHidden();
  await shoot(page, "loading");
  release();
  await expect(page.locator(".draw-region")).toBeVisible();
  await expect(page.getByText("Loading puzzle…")).toHaveCount(0);
});

test("failed live plots collapse and retry independently", async ({ page }) => {
  await mockLive(page, "pending");
  let failed = true;
  await page.route("**/live/live-2026-11-09/*/puzzle.json", async (route) => {
    if (failed) return route.fulfill({ status: 500 });
    await route.fallback();
  });
  await page.goto("/#/live");
  const card = page.locator(".live-card").first();
  await expect(page.locator('.live-card[data-state="failed"]')).toHaveCount(3);
  await expect(card).toHaveAttribute("data-state", "failed");
  await expect(card.locator(".live-chart")).toBeHidden();
  await expect(card.locator(".live-legend")).toBeHidden();
  await shoot(page, "live-error");
  failed = false;
  await card.getByRole("button", { name: "Retry chart" }).click();
  await expect(card.locator(".draw-region")).toBeVisible();
  await expect(card.getByRole("button", { name: "Retry chart" })).toHaveCount(0);
  await expect(page.locator('.live-card[data-state="failed"]')).toHaveCount(2);
  await shoot(page, "live-retried");
});

for (const kind of ["play", "live entry"] as const) {
  test(`a failed restore of a ${kind} reports storage failure and retries`, async ({ page }) => {
    await page.goto("/#/data");
    await page.evaluate(() => {
      const save = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "forecastle.v1.plays" || key === "forecastle.v1.live")
          throw new DOMException("full", "QuotaExceededError");
        save.call(this, key, value);
      };
      Object.defineProperty(window, "restoreWrites", {
        value: () => {
          Storage.prototype.setItem = save;
        },
      });
    });
    const record =
      kind === "play"
        ? play
        : {
            schemaVersion: 1,
            puzzleId: "live-fixture-1",
            path: play.path,
            halfWidth: 1,
            msToLock: 1000,
            status: "kept",
          };
    await page.locator("#restore-file").setInputFiles({
      name: "history.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify([record])),
    });
    await expect(
      page.getByText("Some records could not be saved.", { exact: false }),
    ).toBeVisible();
    await expect(page.getByText("Restored 0 plays.")).toHaveCount(0);
    await shoot(page, "restore-error");
    await page.evaluate(() => {
      const restore = Reflect.get(window, "restoreWrites");
      restore();
    });
    await page.getByRole("button", { name: "Retry restore" }).click();
    await expect(page.locator(".history-list li")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Retry restore" })).toBeHidden();
    await shoot(page, "restore-retried");
  });
}

test("a maximum custom title fits the sheet and leaves submission usable", async ({ page }) => {
  const data = JSON.parse(
    readFileSync(new URL("../fixtures/custom-payload.json", import.meta.url), "utf8"),
  );
  data.label = "X".repeat(80);
  data.unit = "u".repeat(16);
  const encoded = Buffer.from(JSON.stringify(data)).toString("base64url");
  await page.goto(`/#/c/${encoded}`);
  await expect(page.locator("#series-name")).toHaveText(data.label);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const button = await page.getByRole("button", { name: "Hand it in", exact: true }).boundingBox();
  expect(button?.height).toBeLessThan(100);
  const title = await page.locator("#series-name").evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const ink = range.getBoundingClientRect();
    const column = element.parentElement?.getBoundingClientRect();
    if (!column) throw new Error("Missing title column");
    return { left: ink.left, right: ink.right, columnLeft: column.left, columnRight: column.right };
  });
  expect(title.left).toBeGreaterThanOrEqual(title.columnLeft - 1);
  expect(title.right).toBeLessThanOrEqual(title.columnRight + 1);
  await shoot(page, "long-title");
});

test("partial-drawing guidance stays outside the stroke and focused handle", async ({ page }) => {
  await page.goto("/");
  const region = page.locator(".draw-region");
  const box = await region.boundingBox();
  if (!box) throw new Error("Missing drawing region");
  const pointer = { pointerId: 42, pointerType: "touch", isPrimary: true, button: 0, buttons: 1 };
  const x = box.x + box.width / 2;
  await region.dispatchEvent("pointerdown", { ...pointer, clientX: x, clientY: box.y + 1 });
  await region.dispatchEvent("pointermove", {
    ...pointer,
    clientX: x,
    clientY: box.y + box.height / 3,
  });
  await region.dispatchEvent("pointerup", {
    ...pointer,
    clientX: x,
    clientY: box.y + box.height / 3,
    buttons: 0,
  });
  const hint = page.locator(".draw-hint");
  await expect(hint).toHaveText("Keep drawing to +7.");
  const hintBox = await hint.boundingBox();
  expect(hintBox?.y).toBeGreaterThanOrEqual(box.y + box.height - 1);
  await shoot(page, "partial-drawing");
  await expect(page.getByRole("button", { name: "Hand it in", exact: true })).toBeDisabled();
});
