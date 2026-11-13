import { expect, type Locator, type Page } from "@playwright/test";
import game from "../../../data/game.json" with { type: "json" };
import recordedAnswer from "../fixtures/2026-10-21/answer.json" with { type: "json" };
import recordedPuzzle from "../fixtures/2026-10-21/puzzle.json" with { type: "json" };
import frames from "../fixtures/frames-data.json" with { type: "json" };

export const puzzle = { ...recordedPuzzle, id: game.launchDate, number: 1 };
export const answer = { ...recordedAnswer, id: game.launchDate };
export const expected = frames["2026-10-21"];

type Box = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** A day and value on the player's column: days run down it, values across a tenth-wide margin. */
export function onSheet(box: Box, day: number, value: number, [lower, upper] = [5.32, 32.68]) {
  const inset = box.width * 0.1;
  return {
    x: box.x + inset + ((box.width - 2 * inset) * (value - lower)) / (upper - lower),
    y: box.y + (box.height * day) / 7,
  };
}

/** The player's column once a resize has stopped remounting it. */
export async function regionBox(
  page: Page,
  region: Locator = page.locator(".draw-region"),
): Promise<Box> {
  await page.evaluate(() => document.fonts.ready);
  await expect
    .poll(() =>
      region.evaluate((element) => {
        const svg = element instanceof SVGElement ? element.ownerSVGElement : null;
        return (
          svg !== null &&
          Math.abs(svg.clientWidth - svg.viewBox.baseVal.width) < 1 &&
          Math.abs(svg.clientHeight - svg.viewBox.baseVal.height) < 1
        );
      }),
    )
    .toBe(true);
  let previous = "";
  await expect
    .poll(async () => {
      const box = await region.boundingBox();
      const current = JSON.stringify(box);
      const stable = box !== null && current === previous;
      previous = current;
      return stable;
    })
    .toBe(true);
  const box = await region.boundingBox();
  if (!box) throw new Error("Missing drawing region.");
  return box;
}

// Nine moves per day is about sixty for the week.
const MOVES_PER_DAY = 9;

// The game interpolates between samples, so every corner must be a sample or the
// segment that straddles it cuts the corner and moves that day's value.
function along(corners: { clientX: number; clientY: number }[], perSegment: number) {
  const [first] = corners;
  if (!first) throw new Error("Missing stroke corners.");
  return [
    first,
    ...corners.slice(1).flatMap((to, index) => {
      const from = corners[index];
      if (!from) throw new Error("Missing stroke corners.");
      return Array.from({ length: perSegment }, (_, step) => {
        if (step === perSegment - 1) return to;
        const fraction = (step + 1) / perSegment;
        return {
          clientX: from.clientX + (to.clientX - from.clientX) * fraction,
          clientY: from.clientY + (to.clientY - from.clientY) * fraction,
        };
      });
    }),
  ];
}

// With `strokeMs` the stroke is spread over that wall-clock time in evenly spaced moves.
export async function drawRecordedPath(page: Page, options: { strokeMs?: number } = {}) {
  const region = page.locator(".draw-region");
  const box = await regionBox(page);
  const [lower, upper] = puzzle.yDomain;
  if (lower === undefined || upper === undefined) throw new Error("Missing recorded domain.");
  const corners = [puzzle.visible.at(-1) ?? 22.6, ...expected.you.path].map((value, day) => {
    const { x, y } = onSheet(box, day, value, [lower, upper]);
    return { clientX: x, clientY: y + (day === 0 ? 1 : day === 7 ? 0.5 : 0) };
  });
  const points = options.strokeMs === undefined ? corners : along(corners, MOVES_PER_DAY);
  const steps = points.length - 1;
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) throw new Error("Missing recorded endpoints.");
  const pointer = { pointerId: 42, pointerType: "touch", isPrimary: true, button: 0, buttons: 1 };
  await region.dispatchEvent("pointerdown", { ...pointer, ...first });
  const start = Date.now();
  for (const [index, point] of points.slice(1).entries()) {
    if (options.strokeMs !== undefined) {
      const wait = start + (options.strokeMs * (index + 1)) / steps - Date.now();
      if (wait > 0) await page.waitForTimeout(wait);
    }
    await region.dispatchEvent("pointermove", { ...pointer, ...point });
  }
  await region.dispatchEvent("pointerup", { ...pointer, ...last, buttons: 0 });
  await expect
    .poll(async () => {
      const values = await page
        .getByRole("slider", { name: /^Day \d$/u })
        .evaluateAll((handles) =>
          handles.map((handle) => Number(handle.getAttribute("aria-valuenow"))),
        );
      return values.every(
        (value, index) => Math.abs(value - (expected.you.path[index] ?? Infinity)) < 0.001,
      );
    })
    .toBe(true);
  // The nearest permitted width to the recording's 3.4 °C still catches all seven days.
  await page.getByRole("slider", { name: "How sure are you?" }).fill("1.5");
  await expect(page.getByRole("button", { name: "Hand it in", exact: true })).toBeEnabled();
}
