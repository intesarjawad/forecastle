import { expect, type Page, test } from "@playwright/test";
import game from "../../../data/game.json" with { type: "json" };
import { worstCases } from "../fixtures/worst-case";
import { regionBox } from "./recorded-play";

const DAY = new Date(`${game.launchDate}T12:00:00Z`);
const REVEAL_MS = 2_500;

test.use({ timezoneId: "UTC" });

async function drawFlatForecast(page: Page) {
  const box = await regionBox(page);
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + 1);
  await page.mouse.down();
  for (let day = 1; day <= 7; day += 1) await page.mouse.move(x, box.y + (box.height * day) / 7);
  await page.mouse.move(x, box.y + box.height + 1);
  await page.mouse.up();
}

for (const fixture of worstCases) {
  test(`${fixture.name} keeps its card inside the column and its text finite`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.clock.install({ time: DAY });
    await page.route("**/puzzles/*/puzzle.json", (route) =>
      route.fulfill({
        json: { ...(fixture.puzzle as Record<string, unknown>), id: game.launchDate },
      }),
    );
    if (fixture.answer === null) {
      await page.route("**/puzzles/*/answer.json", (route) =>
        route.fulfill({ status: 404, body: "" }),
      );
    } else {
      await page.route("**/puzzles/*/answer.json", (route) =>
        route.fulfill({
          json: { ...(fixture.answer as Record<string, unknown>), id: game.launchDate },
        }),
      );
    }

    await page.goto("/");
    await expect(page.getByRole("slider", { name: /^Day \d$/u })).toHaveCount(7);
    await page.evaluate(() => document.fonts.ready);
    await drawFlatForecast(page);
    await page.getByRole("button", { name: "Hand it in", exact: true }).click();

    if (fixture.answer === null) {
      await expect(page.getByText("The answer did not load. Your drawing is kept.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
    } else {
      await page.clock.runFor(REVEAL_MS);
      await expect(page.locator("#scoreline")).toHaveAttribute("data-reveal", "complete", {
        timeout: 10_000,
      });
      await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();
    }

    await expect(page.locator(".chart-svg")).toHaveCount(1);
    const pageState = await page.evaluate(() => {
      const main = document.querySelector("main");
      if (!main) throw new Error("The match card requires a main column.");
      return {
        scrollWidth: main.scrollWidth,
        clientWidth: main.clientWidth,
        markup: document.body.innerHTML,
      };
    });
    expect(pageState.scrollWidth).toBeLessThanOrEqual(pageState.clientWidth);
    expect(pageState.markup).not.toMatch(/NaN|Infinity/u);
    expect(errors).toEqual([]);
  });
}
