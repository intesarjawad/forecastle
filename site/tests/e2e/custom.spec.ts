import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const payload = readFileSync(
  new URL("../fixtures/custom-payload.txt", import.meta.url),
  "utf8",
).trim();

test("a custom link plays to the reveal from the link alone", async ({ page, baseURL }) => {
  if (!baseURL) throw new Error("Missing baseURL.");
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  await page.goto(`${baseURL}#/c/${payload}`);
  await expect(page.locator("#series-name")).toHaveText("Pumpkin pageviews");

  // A level line down the middle of the player's column, one point per day boundary.
  const region = await page.locator(".draw-region").boundingBox();
  if (!region) throw new Error("Missing drawing region.");
  const x = region.x + region.width / 2;
  await page.mouse.move(x, region.y + 1);
  await page.mouse.down();
  for (let day = 1; day <= 7; day += 1)
    await page.mouse.move(x, region.y + (region.height * day) / 7);
  await page.mouse.move(x, region.y + region.height + 1);
  await page.mouse.up();

  await page.getByRole("button", { name: "Hand it in", exact: true }).click();
  await expect(page.locator("#scoreline")).toHaveAttribute("data-reveal", "complete", {
    timeout: 10_000,
  });

  // The answer travels in the link, so nothing beyond the site's own files is fetched.
  const origin = new URL(baseURL).origin;
  expect(requests.filter((url) => !url.startsWith(origin))).toEqual([]);
  expect(requests.filter((url) => url.includes("/puzzles/"))).toEqual([]);
});

test("a damaged custom link says so", async ({ page, baseURL }) => {
  if (!baseURL) throw new Error("Missing baseURL.");
  await page.goto(`${baseURL}#/c/${payload.slice(0, -40)}`);
  await expect(page.getByText("That custom link is damaged.")).toBeVisible();
});
