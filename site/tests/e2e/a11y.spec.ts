import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import game from "../../../data/game.json" with { type: "json" };
import { customPayload, indexJson, mockIndex, mockLive, routeCases } from "./page-states";
import { answer, drawRecordedPath, puzzle } from "./recorded-play";

const DAY = new Date(`${game.launchDate}T12:00:00Z`);
const REVEAL_MS = 2_500;
// The longest page has about twenty stops, so a full cycle fits well inside this.
const MAX_TABS = 40;
test.use({ timezoneId: "UTC" });

async function stubClipboard(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.resolve() },
    });
  });
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: DAY });
  await page.route("**/puzzles/*/puzzle.json", (route) => route.fulfill({ json: puzzle }));
  await page.route("**/puzzles/*/answer.json", (route) => route.fulfill({ json: answer }));
  await mockIndex(page, indexJson([]));
});

async function expectNoViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(
    violations.map((violation) => ({
      rule: violation.id,
      targets: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}

async function openGame(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.getByRole("slider", { name: /^Day \d$/u })).toHaveCount(7);
  await page.evaluate(() => document.fonts.ready);
}

async function finishReveal(page: Page) {
  await page.clock.runFor(REVEAL_MS);
  await expect(page.locator("#scoreline")).toHaveAttribute("data-reveal", "complete");
}

/** WebKit, like Safari, skips links on a plain Tab; Option+Tab visits every stop. */
async function pressTab(page: Page) {
  const webkit = page.context().browser()?.browserType().name() === "webkit";
  await page.keyboard.press(webkit ? "Alt+Tab" : "Tab");
}

/** Press Tab until the control has focus, and require the focus ring to be drawn on it. */
async function tabTo(page: Page, target: Locator) {
  for (let step = 0; step < MAX_TABS; step += 1) {
    await pressTab(page);
    if (await target.evaluate((element) => element === document.activeElement)) {
      expect(await target.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe(
        "3px",
      );
      return;
    }
  }
  throw new Error("The keyboard never reached the control.");
}

async function drawByKeyboard(page: Page) {
  for (let day = 1; day <= 7; day += 1) {
    await pressTab(page);
    await expect(page.getByRole("slider", { name: `Day ${day}`, exact: true })).toBeFocused();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+ArrowUp");
  }
  await tabTo(page, page.getByRole("slider", { name: "How sure are you?" }));
  await page.keyboard.press("ArrowRight");
  const lock = page.getByRole("button", { name: "Hand it in", exact: true });
  await tabTo(page, lock);
  await expect(lock).toBeEnabled();
  await page.keyboard.press("Enter");
}

async function shareByKeyboard(page: Page) {
  await tabTo(page, page.getByRole("button", { name: "Share", exact: true }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
}

function navLink(page: Page, name: string) {
  return page.getByRole("navigation", { name: "Pages" }).getByRole("link", { name, exact: true });
}

test("every daily state has no axe violations", async ({ page }) => {
  await openGame(page);
  await expectNoViolations(page);

  await drawRecordedPath(page);
  await expectNoViolations(page);

  await page.route("**/puzzles/*/answer.json", (route) => route.fulfill({ status: 404, body: "" }));
  await page.getByRole("button", { name: "Hand it in", exact: true }).click();
  await expect(page.getByText("The answer did not load. Your drawing is kept.")).toBeVisible();
  await expectNoViolations(page);

  await page.route("**/puzzles/*/answer.json", (route) => route.fulfill({ json: answer }));
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await finishReveal(page);
  await expectNoViolations(page);
});

test("today's puzzle being unpublished has no axe violations", async ({ page }) => {
  await page.route("**/puzzles/*/puzzle.json", (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/");
  await expect(page.getByText("Today's puzzle is not published yet.")).toBeVisible();
  await expectNoViolations(page);
});

test("blocked storage has no axe violations", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
  });
  await openGame(page);
  await expect(
    page.getByText("This browser is not saving data, so your streak will not be kept."),
  ).toBeVisible();
  await expectNoViolations(page);
});

test("the copy fallback has no axe violations", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  });
  await openGame(page);
  await drawRecordedPath(page);
  await page.getByRole("button", { name: "Hand it in", exact: true }).click();
  await finishReveal(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByRole("textbox")).toBeFocused();
  await expectNoViolations(page);
});

for (const route of routeCases) {
  test(`${route.name} has no axe violations`, async ({ page }) => {
    await route.setup?.(page);
    await page.goto(`/${route.hash}`);
    await expect(route.ready(page)).toHaveCount(route.count ?? 1);
    await page.evaluate(() => document.fonts.ready);
    await expectNoViolations(page);
  });
}

test("a revealed custom link has no axe violations", async ({ page }) => {
  await openGame(page, `/#/c/${customPayload}`);
  await drawByKeyboard(page);
  await finishReveal(page);
  await expectNoViolations(page);
});

test("a whole visit works from the keyboard alone: play, share, live and your data", async ({
  page,
}) => {
  await stubClipboard(page);
  await mockLive(page, "resolved");
  await openGame(page);
  await drawByKeyboard(page);
  await finishReveal(page);
  await shareByKeyboard(page);

  await tabTo(page, navLink(page, "Live"));
  await page.keyboard.press("Enter");
  await expect(page.locator(".live-commit")).toHaveCount(3);
  await tabTo(page, page.getByRole("link", { name: "OpenTimestamps proof" }).first());

  await tabTo(page, navLink(page, "Your data"));
  await page.keyboard.press("Enter");
  const crowd = page.getByRole("checkbox", { name: "Add my plays to the crowd line" });
  await expect(crowd).toBeChecked();
  await tabTo(page, crowd);
  await page.keyboard.press("Space");
  await expect(crowd).not.toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem("forecastle.v1.crowdOptOut"))).toBe("true");

  await tabTo(page, page.getByRole("button", { name: "Download my history", exact: true }));
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.keyboard.press("Enter"),
  ]);
  expect(download.suggestedFilename()).toBe(`forecastle-history-${game.launchDate}.json`);
  await tabTo(page, page.getByLabel("Restore from a file"));

  await tabTo(page, navLink(page, "Archive"));
  await page.keyboard.press("Enter");
  const entry = page.locator(".archive-list a");
  await tabTo(page, entry);
  await page.keyboard.press("Enter");
  // The day was already played, so the archive shows its finished card.
  await page.clock.runFor(100);
  await expect(page.locator("#scoreline")).toHaveAttribute("data-reveal", "complete");
});

test("a custom link plays through to the share button from the keyboard alone", async ({
  page,
}) => {
  await stubClipboard(page);
  await openGame(page, `/#/c/${customPayload}`);
  await drawByKeyboard(page);
  await finishReveal(page);
  await shareByKeyboard(page);
});

const NAV = [
  "link: Today",
  "link: Archive",
  "link: Live",
  "link: Scoring",
  "link: Your data",
  "link: Star on GitHub",
];
const DAYS = [1, 2, 3, 4, 5, 6, 7].map((day) => `slider: Day ${day}`);
const COMMIT = ["link: fbb02a8affd2", "link: OpenTimestamps proof"];
const FOOTER = "link: Privacy";

/**
 * Focus the first stop, then Tab through the rest. The expected list is the
 * visual reading order, and every focusable element on the page must be in it.
 */
async function expectFocusOrder(page: Page, first: Locator, expected: readonly string[]) {
  const tabbable = await page.evaluate(
    () =>
      [
        ...document.querySelectorAll<HTMLElement>(
          "a[href], button, input, textarea, select, [tabindex]",
        ),
      ].filter(
        (element) =>
          element.tabIndex >= 0 &&
          !element.matches(":disabled") &&
          element.checkVisibility({ visibilityProperty: true }),
      ).length,
  );
  expect(tabbable).toBe(expected.length);
  await first.focus();
  const order: string[] = [];
  for (let step = 0; step < expected.length; step += 1) {
    if (step > 0) await pressTab(page);
    order.push(
      await page.evaluate(() => {
        const element = document.activeElement;
        if (!(element instanceof HTMLElement)) return "none";
        const role =
          element.getAttribute("role") ??
          (element instanceof HTMLAnchorElement
            ? "link"
            : element instanceof HTMLInputElement
              ? element.type === "range"
                ? "slider"
                : element.type
              : element.tagName.toLowerCase());
        const label =
          element.getAttribute("aria-label") ??
          (element instanceof HTMLInputElement ? element.labels?.[0]?.textContent : null) ??
          element.textContent;
        return `${role}: ${(label ?? "").trim()}`;
      }),
    );
  }
  expect(order).toEqual(expected);
}

test("the focus order follows the reading order before drawing, once drawn and after the reveal", async ({
  page,
}) => {
  await openGame(page);
  await expectFocusOrder(page, page.getByRole("slider", { name: "Day 1", exact: true }), [
    ...DAYS,
    ...NAV,
    FOOTER,
  ]);

  await drawRecordedPath(page);
  await expectFocusOrder(page, page.getByRole("slider", { name: "Day 1", exact: true }), [
    ...DAYS,
    "button: Hand it in",
    "slider: How sure are you?",
    ...NAV,
    FOOTER,
  ]);

  await page.getByRole("button", { name: "Hand it in", exact: true }).click();
  await finishReveal(page);
  await expectFocusOrder(page, page.getByRole("button", { name: "Share", exact: true }), [
    "button: Share",
    "link: How scoring works",
    ...NAV,
    FOOTER,
  ]);
});

test("the focus order on every other page puts the page links first", async ({ page }) => {
  const today = () => navLink(page, "Today");

  await page.goto("/#/archive");
  await expect(page.locator(".archive-list a")).toHaveCount(1);
  await expectFocusOrder(page, today(), [
    ...NAV,
    `link: #1: ${puzzle.label}, ${game.launchDate}`,
    FOOTER,
  ]);

  await page.goto("/#/data");
  await expect(page.getByText("No plays are saved on this device yet.")).toBeVisible();
  await expectFocusOrder(page, today(), [
    ...NAV,
    "checkbox: Add my plays to the crowd line",
    "button: Download my history",
    "file: Restore from a file",
    "link: Read the privacy notice",
    FOOTER,
  ]);
});

test("the focus order on the live page visits each chart's commit and proof in turn", async ({
  page,
}) => {
  await mockLive(page, "resolved");
  await page.goto("/#/live");
  await expect(page.locator(".live-commit")).toHaveCount(3);
  await expectFocusOrder(page, navLink(page, "Today"), [
    ...NAV,
    ...COMMIT,
    ...COMMIT,
    ...COMMIT,
    FOOTER,
  ]);
});
