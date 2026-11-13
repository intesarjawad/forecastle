import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import game from "../../../data/game.json" with { type: "json" };
import { indexJson, mockLive } from "./page-states";
import { answer, onSheet, puzzle, regionBox } from "./recorded-play";

const nextDay = new Date(Date.parse(`${game.launchDate}T12:00:00Z`) + 86_400_000)
  .toISOString()
  .slice(0, 10);

test.use({ timezoneId: "UTC" });

test.beforeEach(async ({ page }, info) => {
  await page.setViewportSize(
    info.project.name === "desktop" ? { width: 1440, height: 900 } : { width: 390, height: 844 },
  );
  await page.clock.setFixedTime(new Date(`${game.launchDate}T12:00:00Z`));
  await page.route("**/puzzles/*/puzzle.json", (route) =>
    route.fulfill({
      json: { ...puzzle, id: route.request().url().split("/").at(-2) },
    }),
  );
  await page.route("**/puzzles/index.json", (route) => route.fulfill({ json: indexJson([]) }));
});

async function settled(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

for (const status of [200, 500]) {
  test(`a late ${status} answer leaves the next puzzle untouched`, async ({ page }) => {
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/answer.json", async (route) => {
      await pending;
      await route.fulfill({ status, json: answer });
    });
    await page.goto("/");
    await page.getByRole("slider", { name: "Day 1", exact: true }).press("ArrowUp");
    await page.getByRole("button", { name: "Hand it in", exact: true }).click();
    await expect(page.getByText("Loading the answer.", { exact: false })).toBeVisible();
    await page.evaluate((id) => {
      location.hash = `#/p/${id}`;
    }, nextDay);
    await expect(page.getByRole("slider", { name: /^Day \d$/u })).toHaveCount(7);
    const response = page.waitForResponse("**/answer.json");
    release();
    await response;
    await settled(page);
    await expect(page.locator("#scoreline .result, .answer-error, .share-button")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Hand it in", exact: true })).toBeDisabled();
    expect(await page.evaluate(() => localStorage.getItem("forecastle.v1.plays"))).toBeNull();
  });
}

for (const route of ["archive", "live"]) {
  test(`${route} announces a pending index and clears busy state`, async ({ page }) => {
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/puzzles/index.json", async (response) => {
      await pending;
      await response.fulfill({ json: indexJson([]) });
    });
    await page.goto(`/#/${route}`);
    await expect(page.locator('.page[aria-busy="true"]')).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Loading");
    release();
    await expect(page.locator('.page[aria-busy="true"]')).toHaveCount(0);
    await expect(page.getByText("Loading", { exact: false })).toHaveCount(0);
  });
}

test("an unsaved live entry keeps its controls and can be saved again", async ({ page }) => {
  await mockLive(page, "pending");
  await page.goto("/#/live");
  await page.evaluate(() => {
    const save = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === "forecastle.v1.live") throw new DOMException("full", "QuotaExceededError");
      save.call(this, name, value);
    };
    Reflect.set(window, "resumeSaving", () => {
      Storage.prototype.setItem = save;
    });
  });
  const card = page.locator(".live-card").first();
  await card.getByRole("slider", { name: "Day 1", exact: true }).press("ArrowUp");
  await card.getByRole("button", { name: "Lock", exact: true }).click();
  await expect(card.locator(".live-note")).toContainText("could not be saved");
  await expect(card.locator(".live-note")).toBeFocused();
  await expect(card.getByRole("slider", { name: /^Day \d$/u })).toHaveCount(7);
  await expect(card.getByRole("button", { name: "Lock", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => localStorage.getItem("forecastle.v1.live"))).toBeNull();
  await page.evaluate(() => Reflect.get(window, "resumeSaving")());
  await card.getByRole("button", { name: "Lock", exact: true }).click();
  await expect(card.locator(".live-note")).toContainText("stays on this device");
  await page.reload();
  await expect(page.locator(".live-card").first().getByRole("slider")).toHaveCount(0);
});

for (const file of ["forecast", "answer"]) {
  test(`a failed live ${file} collapses its chart and retries`, async ({ page }) => {
    await mockLive(page, "resolved");
    let failed = true;
    await page.route(`**/live/*/*/${file}.json`, async (route) => {
      if (failed) await route.fulfill({ status: 500 });
      else await route.fallback();
    });
    await page.goto("/#/live");
    const card = page.locator(".live-card").first();
    await expect(card).toHaveAttribute("data-state", "failed");
    await expect(card.locator(".live-chart")).toBeHidden();
    await expect(card.locator(".live-legend")).toBeHidden();
    failed = false;
    await card.getByRole("button", { name: "Retry chart" }).click();
    await expect(card.locator(".chart-machine, .chart-reality")).toHaveCount(2);
    await expect(card).toHaveAttribute("data-state", "resolved");
  });
}

test("the sealed commitment links to its public metadata", async ({ page }) => {
  await mockLive(page, "pending");
  await page.goto("/#/live");
  const commitment = page.locator(".live-commit a").first();
  await expect(commitment).toHaveAttribute("href", /\/puzzle\.json$/u);
  const href = await commitment.getAttribute("href");
  if (!href) throw new Error("Missing commitment URL");
  expect((await page.request.get(href)).ok()).toBe(true);
});

test("the maximum model label wraps within its column", async ({ page }) => {
  const payload = JSON.parse(
    readFileSync(new URL("../fixtures/custom-payload.json", import.meta.url), "utf8"),
  );
  payload.model = "m".repeat(80);
  await page.goto(`/#/c/${Buffer.from(JSON.stringify(payload)).toString("base64url")}`);
  await expect(page.locator(".head-ai .head-days")).toHaveText(payload.model);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const sizes = await page.locator(".head-ai .head-days").evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    column: element.parentElement?.getBoundingClientRect().width ?? 0,
  }));
  expect(sizes.width).toBeLessThanOrEqual(sizes.column);
});

test("the scoring band follows each point at a constant offset", async ({ page }) => {
  await page.goto("/#/how");
  const points = await page.locator(".how-line").getAttribute("points");
  const band = await page.locator(".how-band").getAttribute("points");
  const parse = (text: string | null) =>
    (text ?? "").split(" ").map((pair) => pair.split(",").map(Number));
  const line = parse(points);
  const polygon = parse(band);
  expect(polygon).toHaveLength(line.length * 2);
  for (const [index, point] of line.entries()) {
    const upper = polygon[index];
    const lower = polygon.at(-index - 1);
    expect(upper?.[0]).toBe(point[0]);
    expect(lower?.[0]).toBe(point[0]);
    expect((point[1] ?? 0) - (upper?.[1] ?? 0)).toBe(30);
    expect((lower?.[1] ?? 0) - (point[1] ?? 0)).toBe(30);
  }
});

test("first keyboard focus leaves the reading instruction clear", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("slider", { name: "Day 1", exact: true })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("slider", { name: "Day 1", exact: true })).toBeFocused();
  const prompt = await page.locator("#prompt-line").boundingBox();
  const region = await page.locator(".draw-region").boundingBox();
  if (!prompt || !region) throw new Error("Missing instruction or drawing surface");
  expect(prompt.x + prompt.width).toBeLessThanOrEqual(region.x);
});

for (const view of ["daily", "live"]) {
  test(`${view} keeps the pointer target attached during a resize`, async ({ page }) => {
    if (view === "live") await mockLive(page, "pending");
    await page.goto(view === "daily" ? "/" : "/#/live");
    const region = page.locator(".draw-region").first();
    const box = await regionBox(page, region);
    const element = await region.elementHandle();
    if (!element || !box) throw new Error("Missing drawing surface");
    const pointer = { pointerId: 42, pointerType: "touch", isPrimary: true, button: 0, buttons: 1 };
    await region.dispatchEvent("pointerdown", {
      ...pointer,
      clientX: box.x + box.width / 2,
      clientY: box.y + 1,
    });
    await page.setViewportSize({ width: 430, height: 844 });
    await settled(page);
    expect(await element.evaluate((node) => node.isConnected)).toBe(true);
    await element.dispatchEvent("pointerup", {
      ...pointer,
      clientX: box.x + box.width,
      clientY: box.y + box.height,
      buttons: 0,
    });
    await settled(page);
  });
}

test("a failed live status write stays visible and can be retried", async ({ page }) => {
  await mockLive(page, "pending");
  await page.goto("/#/live");
  await page.evaluate(() => {
    const save = Storage.prototype.setItem;
    let writes = 0;
    Storage.prototype.setItem = function (name, value) {
      if (name === "forecastle.v1.live" && ++writes > 1)
        throw new DOMException("full", "QuotaExceededError");
      save.call(this, name, value);
    };
    Reflect.set(window, "resumeSaving", () => {
      Storage.prototype.setItem = save;
    });
  });
  const card = page.locator(".live-card").first();
  await card.getByRole("slider", { name: "Day 1", exact: true }).press("ArrowUp");
  await card.getByRole("button", { name: "Lock", exact: true }).click();
  await expect(card.locator(".live-note")).toContainText("status could not be saved");
  await expect(card.getByRole("button", { name: "Retry save" })).toBeVisible();
  await page.evaluate(() => Reflect.get(window, "resumeSaving")());
  await card.getByRole("button", { name: "Retry save" }).click();
  await expect(card.getByRole("button", { name: "Retry save" })).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".live-card").first().locator(".live-note")).toContainText(
    "stays on this device",
  );
});

for (const hash of ["#/", `#/p/${game.launchDate}`]) {
  test(`${hash} reuses its early puzzle request`, async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/puzzle.json")) requests.push(request.url());
    });
    await page.goto(`/${hash}`);
    await expect(page.getByRole("slider", { name: /^Day \d$/u })).toHaveCount(7);
    expect(requests).toHaveLength(1);
  });
}

test("the brush-width explanation stays clear of its samples", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".draw-region")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const note = await page.locator(".swatch-note").boundingBox();
  const ink = await page.locator(".swatch-ink").boundingBox();
  if (!note || !ink) throw new Error("Missing brush-width explanation");
  expect(note.x + note.width).toBeLessThanOrEqual(ink.x);
});

test("a saved result has both mark-key glyphs as soon as it appears", async ({ page }) => {
  await page.route("**/answer.json", (route) => route.fulfill({ json: answer }));
  await page.addInitScript(
    (saved) => localStorage.setItem("forecastle.v1.plays", JSON.stringify([saved])),
    {
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
    },
  );
  await page.goto("/");
  await expect(page.locator("#scoreline")).toHaveAttribute("data-reveal", "complete");
  await expect(page.locator(".mark-key .mark-glyph")).toHaveCount(2);
});

test("a late latest-puzzle response leaves the next puzzle untouched", async ({ page }) => {
  let requests = 0;
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/puzzles/*/puzzle.json", async (route) => {
    const id = route.request().url().split("/").at(-2);
    if (id === puzzle.id) {
      if (++requests === 1) {
        await route.fulfill({ status: 404 });
        return;
      }
      await pending;
    }
    await route.fulfill({
      json: { ...puzzle, id, label: id === nextDay ? "Next chart" : puzzle.label },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Play the latest puzzle" }).click();
  await expect.poll(() => requests).toBe(2);
  await page.evaluate((id) => {
    location.hash = `#/p/${id}`;
  }, nextDay);
  await expect(page.locator("#series-name")).toHaveText("Next chart");
  const response = page.waitForResponse(`**/puzzles/${puzzle.id}/puzzle.json`);
  release();
  await response;
  await settled(page);
  await expect(page.locator("#series-name")).toHaveText("Next chart");
});

test("the introductory brush samples finish painting while idle", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator("#swatch-ink");
  await expect
    .poll(() =>
      canvas.evaluate((element) => {
        if (!(element instanceof HTMLCanvasElement)) return false;
        const data = element
          .getContext("2d")
          ?.getImageData(0, 0, element.width, element.height).data;
        return data?.some((value, index) => index % 4 === 3 && value > 0) ?? false;
      }),
    )
    .toBe(true);
});

for (const route of [
  { chunk: "data", hash: "#/data", ready: "#restore-file" },
  { chunk: "how", hash: "#/how", ready: ".how-figure" },
  {
    chunk: "custom-route",
    hash: `#/c/${Buffer.from(readFileSync(new URL("../fixtures/custom-payload.json", import.meta.url))).toString("base64url")}`,
    ready: ".draw-region",
  },
]) {
  test(`${route.chunk} can reload after its code fails to arrive`, async ({ page }) => {
    let failed = true;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(`**/assets/${route.chunk}-*.js`, async (request) => {
      if (failed) await request.abort();
      else await request.continue();
    });
    await page.goto(`/${route.hash}`);
    await expect(page.getByText("This page did not load. Reload to try again.")).toBeVisible();
    failed = false;
    await page.getByRole("button", { name: "Reload page", exact: true }).click();
    await expect(page.locator(route.ready)).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("ink initialization runs once after waiting for a gesture", async ({ page }) => {
  await page.addInitScript(() => {
    const callbacks = new Map<number, IdleRequestCallback>();
    let serial = 0;
    window.requestIdleCallback = (callback) => {
      callbacks.set(++serial, callback);
      return serial;
    };
    window.cancelIdleCallback = (id) => {
      callbacks.delete(id);
    };
    Reflect.set(window, "idleCount", () => callbacks.size);
    Reflect.set(window, "idleFlush", () => {
      const due = [...callbacks.values()];
      callbacks.clear();
      for (const callback of due) callback({ didTimeout: false, timeRemaining: () => 50 });
    });
  });
  await page.route("**/assets/ink-gl-*.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "export function createInkEngine() { window.inkStarts = (window.inkStarts ?? 0) + 1; return { changed() {}, resize() {}, destroy() {} }; }",
    }),
  );
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "idleCount")()))
    .toBeGreaterThan(0);
  await page.evaluate(() => Reflect.get(window, "idleFlush")());
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "idleCount")()))
    .toBeGreaterThan(0);
  const region = page.locator(".draw-region");
  const box = await region.boundingBox();
  if (!box) throw new Error("Missing drawing surface");
  const pointer = {
    pointerId: 42,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: box.x + box.width / 2,
    clientY: box.y + 1,
  };
  await region.dispatchEvent("pointerdown", pointer);
  await page.evaluate(() => Reflect.get(window, "idleFlush")());
  expect(await page.evaluate(() => Reflect.get(window, "inkStarts") ?? 0)).toBe(0);
  await region.dispatchEvent("pointerup", { ...pointer, buttons: 0 });
  await page.evaluate(() => Reflect.get(window, "idleFlush")());
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "inkStarts") ?? 0)).toBe(1);
  await page.locator(".lesson").dispatchEvent("pointercancel", pointer);
  await page.evaluate(() => Reflect.get(window, "idleFlush")());
  await settled(page);
  expect(await page.evaluate(() => Reflect.get(window, "inkStarts"))).toBe(1);
  await expect(page.locator(".ink-gl")).toHaveCount(1);
});

test("the answer opens while crowd code is still loading", async ({ page }) => {
  let release = () => {};
  let requested = false;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/assets/submissions-*.js", async (route) => {
    requested = true;
    await pending;
    await route.continue();
  });
  await page.route("**/answer.json", (route) => route.fulfill({ json: answer }));
  await page.goto("/");
  await page.getByRole("slider", { name: "Day 1", exact: true }).press("ArrowUp");
  await page.getByRole("button", { name: "Hand it in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();
  await expect.poll(() => requested).toBe(true);
  const response = page.waitForResponse("**/assets/submissions-*.js");
  release();
  await response;
  await expect(page.locator(".result")).toHaveCount(1);
});

test("live can reload when its sending code fails to arrive", async ({ page }) => {
  await mockLive(page, "pending");
  let failed = true;
  await page.route("**/assets/submissions-*.js", async (route) => {
    if (failed) await route.abort();
    else await route.continue();
  });
  await page.goto("/#/live");
  await expect(page.getByText("This page did not load. Reload to try again.")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("forecastle.v1.live"))).toBeNull();
  failed = false;
  await page.getByRole("button", { name: "Reload page", exact: true }).click();
  const card = page.locator(".live-card").first();
  await card.getByRole("slider", { name: "Day 1", exact: true }).press("ArrowUp");
  await card.getByRole("button", { name: "Lock", exact: true }).click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("forecastle.v1.live") ?? "null"),
  );
  expect(saved).toEqual([expect.objectContaining({ status: "unserved" })]);
});

test("the supporting faces load after the daily drawing is ready", async ({ page }) => {
  const requests: boolean[] = [];
  await page.route("**/*{400,800}*.woff2", async (route) => {
    requests.push(
      await page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>(".ink-layer");
        if (!canvas) return false;
        return (
          canvas
            .getContext("2d")
            ?.getImageData(0, 0, canvas.width, canvas.height)
            .data.some((value, index) => index % 4 === 3 && value > 0) ?? false
        );
      }),
    );
    await route.continue();
  });
  await page.goto("/");
  await expect(page.getByRole("slider", { name: /^Day \d$/u })).toHaveCount(7);
  await expect.poll(() => requests.length).toBe(2);
  expect(requests).toEqual([true, true]);
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.fonts].some((face) => face.weight === "800" && face.status === "loaded"),
      ),
    )
    .toBe(true);
});

test("the result can reload after its code fails to arrive", async ({ page }) => {
  let failed = true;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/assets/daily-result-*.js", async (route) => {
    if (failed) await route.abort();
    else await route.continue();
  });
  await page.route("**/answer.json", (route) => route.fulfill({ json: answer }));
  const handIn = async () => {
    await page.getByRole("slider", { name: "Day 1", exact: true }).press("ArrowUp");
    await page.getByRole("button", { name: "Hand it in", exact: true }).click();
  };
  await page.goto("/");
  await handIn();
  await expect(page.getByText("This page did not load. Reload to try again.")).toBeVisible();
  failed = false;
  await page.getByRole("button", { name: "Reload page", exact: true }).click();
  await handIn();
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("the title face finishes loading while game code is still arriving", async ({ page }) => {
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/assets/index-*.js", async (route) => {
    await pending;
    await route.continue();
  });
  await page.goto("/", { waitUntil: "commit" });
  await expect(page.getByRole("heading", { name: "Forecastle", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Loading…");
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.fonts].some((face) => face.weight === "600" && face.status === "loaded"),
      ),
    )
    .toBe(true);
  await expect(page.locator(".draw-region")).toHaveCount(0);
  release();
  await expect(page.getByRole("slider", { name: /^Day \d$/u })).toHaveCount(7);
});

test("the ink and active stroke follow a narrower viewport", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 844 });
  await page.goto("/");
  const region = page.locator(".draw-region");
  const box = await regionBox(page, region);
  const pointer = {
    pointerId: 42,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX: onSheet(box, 0, 22.6).x,
    clientY: onSheet(box, 0, 22.6).y + 1,
  };
  await region.dispatchEvent("pointerdown", pointer);
  await page.setViewportSize({ width: 390, height: 844 });
  await settled(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const resized = await region.boundingBox();
  if (!resized) throw new Error("Missing drawing surface");
  const end = onSheet(resized, 7, 22.6);
  await region.dispatchEvent("pointermove", { ...pointer, clientX: end.x, clientY: end.y + 1 });
  await region.dispatchEvent("pointerup", {
    ...pointer,
    clientX: end.x,
    clientY: end.y + 1,
    buttons: 0,
  });
  await expect
    .poll(() =>
      page
        .getByRole("slider", { name: /^Day \d$/u })
        .evaluateAll((handles) =>
          handles.every(
            (handle) => Math.abs(Number(handle.getAttribute("aria-valuenow")) - 22.6) < 0.0001,
          ),
        ),
    )
    .toBe(true);
});

test("a delayed crowd import keeps the date on which the drawing was locked", async ({ page }) => {
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/assets/submissions-*.js", async (route) => {
    await pending;
    await route.fulfill({
      contentType: "text/javascript",
      body: "export function createSubmission(play) { window.lockedDate = play.utcDate; return { lock() {}, reveal() {} }; }",
    });
  });
  await page.route("**/answer.json", (route) => route.fulfill({ json: answer }));
  await page.goto("/");
  await page.getByRole("slider", { name: "Day 1", exact: true }).press("ArrowUp");
  await page.getByRole("button", { name: "Hand it in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();
  await page.clock.setFixedTime(new Date(`${nextDay}T12:00:00Z`));
  release();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "lockedDate")))
    .toBe(game.launchDate);
});

test("installation metadata arrives after the daily ink has painted", async ({ page }) => {
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      if (!document.querySelector('link[rel="manifest"]')) return;
      const canvas = document.querySelector<HTMLCanvasElement>(".ink-layer");
      const pixels = canvas?.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
      Reflect.set(
        window,
        "installAfterInk",
        pixels?.some((value, index) => index % 4 === 3 && value > 0) ?? false,
      );
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "installAfterInk"))).toBe(true);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "./favicon.svg");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("sizes", "180x180");
  const response = await page.request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
});

test("an unpublished daily page loads its text and display faces", async ({ page }) => {
  await page.route("**/puzzles/*/puzzle.json", (route) => route.fulfill({ status: 404 }));
  await page.goto("/");
  await expect(page.getByText("Today's puzzle is not published yet.")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        ["400", "600", "800"].every((weight) =>
          [...document.fonts].some((face) => face.weight === weight && face.status === "loaded"),
        ),
      ),
    )
    .toBe(true);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
});

for (const view of ["daily", "live"]) {
  test(`${view} focused drawing handles keep their nodes and geometry after a resize`, async ({
    page,
  }) => {
    if (view === "live") await mockLive(page, "pending");
    await page.goto(view === "daily" ? "/" : "/#/live");
    const root = page.locator(view === "daily" ? ".lesson" : ".live-card").first();
    await regionBox(page, root.locator(".draw-region"));
    const target = await root.locator(".draw-region").elementHandle();
    if (!target) throw new Error("Missing drawing surface");
    const handle = root.getByRole("slider", { name: "Day 1", exact: true });
    await handle.focus();
    const element = await handle.elementHandle();
    if (!element) throw new Error("Missing drawing handle");
    await handle.press("ArrowUp");
    await expect
      .poll(() =>
        root
          .locator(".chart-svg")
          .evaluate(
            (svg) =>
              svg instanceof SVGSVGElement &&
              Math.abs(svg.viewBox.baseVal.height - svg.clientHeight) < 1,
          ),
      )
      .toBe(true);
    await page.setViewportSize({ width: 430, height: 844 });
    await settled(page);
    expect(await target.evaluate((node) => node.isConnected)).toBe(true);
    expect(await element.evaluate((node) => node.isConnected)).toBe(true);
    expect(await element.evaluate((node) => node === document.activeElement)).toBe(true);
    expect(await element.evaluate((node) => getComputedStyle(node).outlineWidth)).toBe("3px");
  });
}

test("the loading header keeps the JavaScript instructions visible when scripts are disabled", async ({
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Missing preview URL");
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    await page.goto(baseURL);
    await expect(page.locator("#startup-loading")).toBeHidden();
    const instruction = page.locator("p.noscript");
    await expect(instruction).toHaveText(
      "Forecastle needs JavaScript to draw. Turn on JavaScript for this site, then reload.",
    );
    await expect(instruction).toBeInViewport();
  } finally {
    await context.close();
  }
});
