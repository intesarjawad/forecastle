import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import game from "../../../data/game.json" with { type: "json" };
import { answer, drawRecordedPath, puzzle } from "./recorded-play";

const GREEN = "\u25CE";
const YELLOW = "\u25CB";
const WHITE = "\u25CC";
const DAY = new Date(`${game.launchDate}T12:00:00Z`);

test.use({ timezoneId: "UTC" });

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: DAY });
  await page.route("**/puzzles/*/puzzle.json", (route) => route.fulfill({ json: puzzle }));
  await page.route("**/puzzles/*/answer.json", (route) => route.fulfill({ json: answer }));
});

// The recorded play: You 85, AI 55, a band that caught 7 of 7 days.
function sharedText(baseURL: string | undefined) {
  return [
    `Forecastle #${puzzle.number}: You 85, AI 55`,
    `You ${GREEN}${GREEN}${YELLOW}${GREEN}${GREEN}${GREEN}${GREEN}`,
    `AI  ${GREEN}${GREEN}${WHITE}${YELLOW}${YELLOW}${GREEN}${GREEN}`,
    "Band caught 7/7",
    `${baseURL}/#/p/${puzzle.id}`,
  ].join("\n");
}

async function play(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("slider", { name: /^Day \d$/u })).toHaveCount(7);
  // The sheet, the shared text and the demo's card all number the puzzle from one fixture.
  await expect(page.locator("#match-number")).toHaveText(`No. ${puzzle.number}`);
  await page.evaluate(() => document.fonts.ready);
  await drawRecordedPath(page);
  await page.getByRole("button", { name: "Hand it in", exact: true }).click();
  await page.clock.runFor(2500);
  await expect(page.locator("#scoreline")).toHaveAttribute("data-reveal", "complete");
}

test("Share copies the exact result text, says so for two seconds and sends nothing", async ({
  page,
  context,
  browserName,
  baseURL,
}) => {
  if (browserName === "chromium")
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await play(page);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const share = page.getByRole("button", { name: "Share", exact: true });
  await expect(share).toHaveCSS("min-height", "44px");
  await share.click();
  await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Copied");
  // Browsers other than Chromium forbid reading the clipboard back in automation.
  if (browserName === "chromium")
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(sharedText(baseURL));
  await page.clock.runFor(1500);
  await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  await page.clock.runFor(600);
  await expect(share).toHaveText("Share");
  expect(requests).toEqual([]);
});

for (const failure of ["missing", "rejecting"] as const)
  test(`a ${failure} clipboard shows the text selected in a textarea`, async ({
    page,
    baseURL,
  }) => {
    await page.addInitScript((mode) => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value:
          mode === "missing"
            ? undefined
            : { writeText: () => Promise.reject(new DOMException("blocked", "NotAllowedError")) },
      });
    }, failure);
    await play(page);
    await page.getByRole("button", { name: "Share", exact: true }).click();
    const text = page.getByRole("textbox", {
      name: "Copying is blocked in this browser. Select all and copy.",
    });
    await expect(text).toHaveValue(sharedText(baseURL));
    await expect(text).toHaveJSProperty("readOnly", true);
    await expect(text).toBeFocused();
    expect(
      await text.evaluate((element: HTMLTextAreaElement) => [
        element.selectionStart,
        element.selectionEnd - element.value.length,
      ]),
    ).toEqual([0, 0]);
    await expect(page.getByRole("button", { name: "Copied" })).toHaveCount(0);
  });

test("corrupt saved plays are ignored and the game plays on", async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("forecastle.v1.plays"))
      localStorage.setItem("forecastle.v1.plays", '[{"puzzleId":"2026-11-20"');
  });
  await play(page);
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();
  await expect(page.getByText("Streak 1 day, best 1.")).toBeVisible();
  await page.reload();
  await page.clock.runFor(100);
  await expect(page.locator("#scoreline")).toHaveAttribute("data-reveal", "complete");
});

test("a record from a newer schema is ignored", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "forecastle.v1.plays",
      JSON.stringify([
        {
          schemaVersion: 2,
          puzzleId: "2026-11-20",
          kind: "daily",
          playedOn: "2026-11-20",
          path: [1, 2, 3, 4, 5, 6, 7],
          halfWidth: 1,
          closeness: 50,
          aiCloseness: 50,
          coverage: 3,
          stats: null,
        },
      ]),
    );
  });
  await page.goto("/");
  await expect(page.getByRole("slider", { name: /^Day \d$/u })).toHaveCount(7);
  await expect(page.getByRole("button", { name: "Hand it in", exact: true })).toBeDisabled();
});

test("blocked storage says so once and the game stays playable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
  });
  await page.goto("/");
  await expect(page.getByRole("slider", { name: /^Day \d$/u })).toHaveCount(7);
  const message = page.getByText(
    "This browser is not saving data, so your streak will not be kept.",
  );
  await expect(message).toHaveCount(1);
  await drawRecordedPath(page);
  await page.getByRole("button", { name: "Hand it in", exact: true }).click();
  await page.clock.runFor(2500);
  await expect(page.locator("#scoreline")).toHaveAttribute("data-reveal", "complete");
  await expect(message).toHaveCount(1);
  await page.getByRole("button", { name: "Play anyway" }).click();
  await expect(message).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();
});

test("a reload after a play shows the same card and contacts only the preview origin", async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Missing baseURL.");
  await play(page);
  const card = () =>
    page.evaluate(() => ({
      you: document.getElementById("you-score")?.textContent,
      ai: document.getElementById("ai-score")?.textContent,
      stamp: document.querySelector(".result-stamp")?.textContent,
      verdict: document.querySelector(".result-reason")?.textContent,
      cells: Array.from(document.querySelectorAll(".day-cell"), (cell) => [
        cell.className,
        cell.textContent,
        getComputedStyle(cell).opacity,
      ]),
      key: document.querySelector(".mark-key")?.textContent,
    }));
  const before = await card();
  const requests: { url: string; method: string }[] = [];
  page.on("request", (request) => requests.push({ url: request.url(), method: request.method() }));
  await page.reload();
  await page.clock.runFor(100);
  await expect(page.locator("#scoreline")).toHaveAttribute("data-reveal", "complete");
  expect(await card()).toEqual(before);
  expect(before.you).toBe("85");
  expect(before.cells.every(([, , opacity]) => opacity === "1")).toBe(true);
  await expect(page.getByRole("slider")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Hand it in", exact: true })).toHaveCount(0);
  await expect(page.getByText(/^Streak .* Next puzzle in \d+ h \d{2} m$/u)).toHaveText(
    "Streak 1 day, best 1. Next puzzle in 12 h 00 m",
  );
  expect(requests.filter((request) => request.url.endsWith("/answer.json"))).toHaveLength(1);
  expect(requests.every((request) => request.method === "GET")).toBe(true);
  const origin = new URL(baseURL).origin;
  expect(requests.every((request) => new URL(request.url).origin === origin)).toBe(true);
});

test("the phone sheet holds the match through the Share button without scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await play(page);
  const card = await page.locator(".lesson-page").boundingBox();
  const share = await page.locator(".share-button").boundingBox();
  if (!card || !share) throw new Error("Missing sheet or Share button.");
  expect(card.y).toBeGreaterThanOrEqual(0);
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.x + card.width).toBeLessThanOrEqual(390);
  expect(share.y + share.height).toBeLessThanOrEqual(844);
  expect(share.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("a shared result opens its own puzzle after the calendar changes", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", { value: undefined }),
  );
  await play(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const text = await page.locator(".share-text").inputValue();
  const link = text.split("\n").at(-1);
  if (!link) throw new Error("Missing shared puzzle link.");
  await page.clock.setSystemTime(new Date(DAY.getTime() + 86_400_000));
  await page.goto(link);
  await expect(page.locator("#series-name")).toHaveText(puzzle.label);
  await expect(page.locator("#match-number")).toHaveText(`No. ${puzzle.number}`);
  expect(new URL(page.url()).hash).toBe(`#/p/${puzzle.id}`);
});
