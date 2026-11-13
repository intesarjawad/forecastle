import { chartYDomain } from "../core/y-scale";
import type { LiveAnswer, LiveForecast, LiveGeometry, LivePuzzle, LiveTableRow } from "../io/live";
import { type ChartDrawing, drawFrom, renderChart } from "./chart";
import type { LiveCard } from "./live-card";
import { messages } from "./messages";

const SVG = "http://www.w3.org/2000/svg";

const coordinate = (value: number) => Number(value.toFixed(2));

/** The future is drawn as gap days followed by scored days, unlike a daily puzzle's seven. */
export function futureSlotX(
  geometry: Pick<LiveGeometry, "today" | "right">,
  slot: number,
  slots: number,
): number {
  if (slots <= 0) throw new Error("The future requires at least one slot.");
  return geometry.today + ((geometry.right - geometry.today) * (slot + 1)) / slots;
}

/** A path from the last visible value through the scored values, leaving the gap open. */
export function livePath(
  values: readonly number[],
  geometry: LiveGeometry,
  gapDays: number,
  origin: number,
): string {
  const slots = gapDays + values.length;
  const points: Array<readonly [number, number]> = [[geometry.today, geometry.y(origin)]];
  values.forEach((value, index) => {
    points.push([futureSlotX(geometry, gapDays + index, slots), geometry.y(value)]);
  });
  return `M${points.map(([x, y]) => `${coordinate(x)},${coordinate(y)}`).join("L")}`;
}

/** The hatched box covers only the unscored days between history and the forecast. */
export function liveGapBox(
  geometry: LiveGeometry,
  gapDays: number,
  horizon: number,
): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} | null {
  if (gapDays <= 0) return null;
  const right = futureSlotX(geometry, gapDays - 1, gapDays + horizon);
  return {
    x: coordinate(geometry.today),
    y: coordinate(geometry.top),
    width: coordinate(right - geometry.today),
    height: coordinate(geometry.bottom - geometry.top),
  };
}

/** Align each line with its scored date; absent series leave their column out. */
export function liveTableRows(
  puzzle: Pick<LivePuzzle, "scoredDates">,
  forecast?: LiveForecast,
  answer?: LiveAnswer,
): LiveTableRow[] {
  return puzzle.scoredDates.map((date, index) => ({
    date,
    ...(forecast?.median[index] === undefined ? {} : { ai: forecast.median[index] }),
    ...(answer?.crowd?.median[index] === undefined ? {} : { crowd: answer.crowd.median[index] }),
    ...(answer?.actual[index] === undefined ? {} : { actual: answer.actual[index] }),
  }));
}

function svgPath(d: string, className: string, label: string): SVGPathElement {
  const element = document.createElementNS(SVG, "path");
  element.setAttribute("d", d);
  element.setAttribute("class", className);
  const title = document.createElementNS(SVG, "title");
  title.textContent = label;
  element.append(title);
  return element;
}

function updateTable(card: LiveCard): void {
  card.table.replaceChildren();
  if (!card.puzzle || (!card.forecast && !card.answer)) return;
  const wrapper = document.createElement("div");
  wrapper.className = "visually-hidden";
  const table = document.createElement("table");
  const caption = document.createElement("caption");
  caption.textContent = messages.live.table(card.puzzle.label);
  const head = document.createElement("tr");
  const columns = [
    messages.live.columns.date,
    ...(card.forecast ? [messages.live.columns.ai] : []),
    ...(card.answer?.crowd ? [messages.live.columns.crowd] : []),
    ...(card.answer ? [messages.live.columns.actual] : []),
  ];
  for (const column of columns) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = column;
    head.append(cell);
  }
  const headGroup = document.createElement("thead");
  headGroup.append(head);
  const body = document.createElement("tbody");
  for (const row of liveTableRows(card.puzzle, card.forecast, card.answer)) {
    const line = document.createElement("tr");
    const day = document.createElement("th");
    day.scope = "row";
    day.textContent = row.date;
    line.append(day);
    for (const value of [
      ...(card.forecast ? [row.ai] : []),
      ...(card.answer?.crowd ? [row.crowd] : []),
      ...(card.answer ? [row.actual] : []),
    ]) {
      const cell = document.createElement("td");
      cell.textContent = value === undefined ? messages.live.blank : String(value);
      line.append(cell);
    }
    body.append(line);
  }
  table.append(caption, headGroup, body);
  wrapper.append(table);
  card.table.append(wrapper);
}

export function paintLiveCard(card: LiveCard): void {
  const puzzle = card.puzzle;
  if (!puzzle || card.drawing?.active()) return;
  const width = card.chartSlot.clientWidth;
  const height = card.chartSlot.clientHeight;
  if (width <= 0 || height <= 0) return;
  const paintKey = JSON.stringify([
    width,
    height,
    card.forecast,
    card.answer,
    card.saved,
    Boolean(card.drawing),
    "forecast" in card.match ? card.match.forecast : null,
  ]);
  if (card.paintKey === paintKey) return;
  card.paintKey = paintKey;
  const focused = card.chartSlot.contains(document.activeElement) ? document.activeElement : null;
  const domain = chartYDomain(
    puzzle.yDomain,
    [...(card.answer?.actual ?? []), ...(card.forecast?.median ?? [])],
    card.forecast ? { lower: card.forecast.q10, upper: card.forecast.q90 } : undefined,
  );
  const mine = card.saved
    ? card.saved
    : "forecast" in card.match && card.match.forecast
      ? {
          path: card.match.forecast.path,
          halfWidth: card.match.forecast.multiplier * puzzle.typicalMove,
        }
      : undefined;
  const drawing: ChartDrawing = renderChart(
    {
      id: puzzle.id,
      label: puzzle.label,
      unit: puzzle.unit,
      width,
      height,
      visible: puzzle.visible,
      yDomain: domain,
      gapDays: puzzle.gapDays,
      ...(mine
        ? {
            player: {
              path: mine.path,
              band: {
                lower: mine.path.map((value) => value - mine.halfWidth),
                upper: mine.path.map((value) => value + mine.halfWidth),
              },
            },
          }
        : {}),
    },
    card.chartSlot,
  );
  const svg = card.chartSlot.querySelector("svg");
  if (!svg) return;
  // The daily prompt starts at today, but a live entry starts after the gap.
  svg.querySelector("[data-draw-idle]")?.remove();
  svg.querySelector(".chart-empty")?.remove();
  const geometry: LiveGeometry = {
    today: drawing.today,
    right: drawing.right,
    top: drawing.top,
    bottom: drawing.bottom,
    y: drawing.y,
  };
  const overlay = document.createElementNS(SVG, "g");
  overlay.setAttribute("data-live", card.state);
  const gap = liveGapBox(geometry, puzzle.gapDays, puzzle.horizon);
  const origin = puzzle.visible.at(-1);
  if (gap && origin !== undefined) {
    const patternId = `live-gap-${card.number}`;
    const defs = document.createElementNS(SVG, "defs");
    const pattern = document.createElementNS(SVG, "pattern");
    pattern.setAttribute("id", patternId);
    pattern.setAttribute("width", "6");
    pattern.setAttribute("height", "6");
    pattern.setAttribute("patternUnits", "userSpaceOnUse");
    pattern.setAttribute("patternTransform", "rotate(45)");
    const stroke = document.createElementNS(SVG, "line");
    stroke.setAttribute("x1", "0");
    stroke.setAttribute("y1", "0");
    stroke.setAttribute("x2", "0");
    stroke.setAttribute("y2", "6");
    stroke.setAttribute("stroke", "currentColor");
    stroke.setAttribute("stroke-opacity", "0.4");
    stroke.setAttribute("stroke-width", "1");
    pattern.append(stroke);
    defs.append(pattern);
    const box = document.createElementNS(SVG, "rect");
    box.setAttribute("class", "chart-gap");
    box.setAttribute("data-gap", String(puzzle.gapDays));
    box.setAttribute("x", String(gap.x));
    box.setAttribute("y", String(gap.y));
    box.setAttribute("width", String(gap.width));
    box.setAttribute("height", String(gap.height));
    box.setAttribute("fill", `url(#${patternId})`);
    const title = document.createElementNS(SVG, "title");
    title.textContent = messages.live.gap(puzzle.gapDays);
    overlay.append(title, defs, box);
  }
  if (card.forecast && origin !== undefined) {
    overlay.append(
      svgPath(
        livePath(card.forecast.median, geometry, puzzle.gapDays, origin),
        "chart-machine",
        messages.live.legend.ai,
      ),
    );
  }
  if (card.answer?.crowd && origin !== undefined) {
    const crowd = svgPath(
      livePath(card.answer.crowd.median, geometry, puzzle.gapDays, origin),
      "chart-crowd",
      messages.live.legend.crowd,
    );
    crowd.setAttribute("fill", "none");
    crowd.setAttribute("stroke", "currentColor");
    crowd.setAttribute("stroke-width", "2");
    crowd.setAttribute("stroke-dasharray", "2 4");
    crowd.setAttribute("stroke-linecap", "round");
    overlay.append(crowd);
  }
  if (card.answer && origin !== undefined) {
    overlay.append(
      svgPath(
        livePath(card.answer.actual, geometry, puzzle.gapDays, origin),
        "chart-reality",
        messages.live.legend.actual,
      ),
    );
    const slots = puzzle.gapDays + puzzle.horizon;
    card.answer.actual.forEach((value, index) => {
      const ring = document.createElementNS(SVG, "circle");
      ring.setAttribute("class", "chart-day-ring");
      ring.setAttribute(
        "cx",
        String(coordinate(futureSlotX(geometry, puzzle.gapDays + index, slots))),
      );
      ring.setAttribute("cy", String(coordinate(geometry.y(value))));
      overlay.append(ring);
    });
  }
  svg.append(overlay);
  // The pen starts where the scored days start, so the hatched gap cannot be drawn on.
  card.drawing?.mount(
    card.chartSlot,
    drawFrom(
      drawing,
      puzzle.gapDays > 0
        ? futureSlotX(geometry, puzzle.gapDays - 1, puzzle.gapDays + puzzle.horizon)
        : drawing.today,
    ),
  );
  if (focused instanceof HTMLElement && focused.isConnected) focused.focus({ focusVisible: true });
  updateTable(card);
}
