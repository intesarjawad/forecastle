import type { Interval } from "../core/types";
import { chartYDomain, type YDomain } from "../core/y-scale";
import { type Point, seeded } from "./brush";
import { yTicks } from "./chart";
import type { DrawSurface } from "./draw";

/** Right to left, as the sheet is read: the oldest week first, the model's copy last. */
export const COLUMNS = ["w0", "w1", "w2", "w3", "you", "ai"] as const;
export type Column = (typeof COLUMNS)[number];
export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};
/** Column bodies measured from the page; a column the layout hides is null. */
export type SheetFrame = {
  readonly width: number;
  readonly height: number;
  readonly columns: Readonly<Record<Column, Rect | null>>;
};
export type Week = { readonly anchor: number | null; readonly values: readonly number[] };

const DAYS = 7;
const WEEKS = 4;
// Each column keeps a margin inside its folds, so a value at the domain's edge still reads as ink on paper.
const COLUMN_INSET = 0.1;
const TICK_LABEL_RISE = 8;
const HALFTONE = 6;
const START_RADIUS = 5;
const COPY_DOT = 3;
/** How far the dotted thread runs into the margins above and below the sheet. */
const LINK_MARGIN = 14;
// Shippori Mincho's figures at 12 px are about 7 px wide; labels keep a 6 px gap between them.
const TICK_CHARACTER = 7;
const TICK_GAP = 6;

/** The 28 visible days as four written weeks; each week carries in from the last day before it. */
export function weeks(visible: readonly number[]): Week[] {
  if (visible.length !== DAYS * WEEKS) throw new Error("A sheet needs 28 visible days.");
  return Array.from({ length: WEEKS }, (_, week) => ({
    anchor: week === 0 ? null : (visible[week * DAYS - 1] ?? null),
    values: visible.slice(week * DAYS, week * DAYS + DAYS),
  }));
}

export type SheetGeometry = {
  readonly domain: YDomain;
  readonly phone: boolean;
  /** A column's rectangle; on a phone the earlier weeks show through the last one. */
  readonly rect: (column: Column) => Rect;
  readonly x: (column: Column, value: number) => number;
  /** Day 0 is the carried-in value at the column's top edge, day 7 its bottom edge. */
  readonly y: (column: Column, day: number) => number;
  readonly value: (column: Column, x: number) => number;
  readonly day: (column: Column, y: number) => number;
  /** Pixels per unit of the series, the same in every column. */
  readonly scale: number;
};

export function sheetGeometry(frame: SheetFrame, domain: YDomain): SheetGeometry {
  const you = frame.columns.you;
  if (!you) throw new Error("A sheet needs the player's column.");
  const rect = (column: Column): Rect => {
    const own = frame.columns[column];
    if (own) return own;
    const last = frame.columns.w3;
    if (!last) throw new Error("A sheet needs the last given week.");
    return last;
  };
  const inset = you.width * COLUMN_INSET;
  const span = you.width - 2 * inset;
  const scale = span / (domain[1] - domain[0]);
  return {
    domain,
    phone: frame.columns.w0 === null,
    rect,
    scale,
    x: (column, value) => rect(column).x + inset + (value - domain[0]) * scale,
    y: (column, day) => {
      const { y, height } = rect(column);
      return y + (day / DAYS) * height;
    },
    value: (column, x) => domain[0] + (x - rect(column).x - inset) / scale,
    day: (column, y) => {
      const box = rect(column);
      return ((y - box.y) / box.height) * DAYS;
    },
  };
}

export type SheetState = {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly visible: readonly number[];
  readonly yDomain: YDomain;
  readonly model?: { readonly median: readonly number[]; readonly interval: Interval };
  readonly real?: readonly number[];
};

export type SheetDrawing = DrawSurface & {
  readonly geometry: SheetGeometry;
  readonly crowd: (svg: SVGSVGElement, median: readonly number[]) => void;
};

/** What the ink layer needs to hear about the player's column. */
export type PlayerInk = {
  readonly path: (values: readonly number[], halfWidth: number) => void;
  readonly raw: (points: readonly (readonly [number, number])[]) => void;
};

const coordinate = (value: number) => Number(value.toFixed(2));

/** A cubic Bézier sampled about every 4 px. */
function cubic(a: Point, b: Point, c: Point, d: Point): Point[] {
  const steps = Math.max(4, Math.ceil(Math.hypot(d[0] - a[0], d[1] - a[1]) / 4));
  return Array.from({ length: steps }, (_, step): Point => {
    const t = step / steps;
    const [u, v, w, z] = [(1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t * t * (1 - t), t ** 3];
    return [u * a[0] + v * b[0] + w * c[0] + z * d[0], u * a[1] + v * b[1] + w * c[1] + z * d[1]];
  });
}

/**
 * A line in graphite: its weight follows the pencil's pressure between about 0.75 and 1 px,
 * it is laid in short lengths of lighter and darker lead where the paper's tooth catches it,
 * and it lifts at both ends.
 */
function graphite(points: readonly Point[]): string {
  const random = seeded(29);
  const phase = random() * Math.PI * 2;
  const last = points.length - 1;
  const edges = points.map(([x, y], index) => {
    const [px, py] = points[Math.max(0, index - 1)] ?? [x, y];
    const [nx, ny] = points[Math.min(last, index + 1)] ?? [x, y];
    const size = Math.hypot(nx - px, ny - py) || 1;
    const t = index / last;
    const lift = Math.min(1, 0.3 + 6 * Math.min(t, 1 - t));
    const half = ((0.75 + 0.25 * (0.5 + 0.5 * Math.sin(t * 11 + phase))) * lift) / 2;
    const [ox, oy] = [(-(ny - py) / size) * half, ((nx - px) / size) * half];
    return [
      [x + ox, y + oy],
      [x - ox, y - oy],
    ] as const;
  });
  let out = "";
  for (let from = 0; from < last; ) {
    const to = Math.min(last, from + 3 + Math.floor(random() * 5));
    const run = edges.slice(from, to + 1);
    const outline = [...run.map(([left]) => left), ...run.map(([, right]) => right).reverse()];
    out += `<path d="${path(outline)}Z" fill-opacity="${(0.45 + random() * 0.3).toFixed(2)}"/>`;
    from = to;
  }
  return out;
}
const path = (points: readonly (readonly [number, number])[]) =>
  `M${points.map(([x, y]) => `${coordinate(x)},${coordinate(y)}`).join("L")}`;
const escapeText = (value: string) =>
  value.replace(/[&<>"']/gu, (character) => `&#${character.charCodeAt(0)};`);
const tickLabel = (value: number) =>
  new Intl.NumberFormat("en-US", {
    maximumSignificantDigits: 3,
    notation: Math.abs(value) >= 10000 ? "compact" : "standard",
  }).format(value);

/**
 * The ticks that get a label: on a narrow column, long labels such as "1,800" would touch,
 * so every other one is dropped until they clear each other. The creases stay for all.
 */
export function labelledTicks(ticks: readonly number[], scale: number): number[] {
  let kept = [...ticks];
  const width = Math.max(...ticks.map((tick) => tickLabel(tick).length)) * TICK_CHARACTER;
  while (kept.length > 2 && ((kept[1] ?? 0) - (kept[0] ?? 0)) * scale < width + TICK_GAP)
    kept = kept.filter((_, index) => index % 2 === 0);
  return kept;
}

function historyTable(state: SheetState): string {
  const rows = state.visible.map(
    (value, index) =>
      `<tr><th scope="row">${index === 27 ? "today" : `−${27 - index} d`}</th><td>${escapeText(String(value))}</td></tr>`,
  );
  return `<div class="visually-hidden"><table><caption>${escapeText(state.label)}: 28 visible daily values</caption><thead><tr><th scope="col">Day</th><th scope="col">Value${state.unit ? ` (${escapeText(state.unit)})` : ""}</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

/**
 * Print the sheet's fixed matter (folds, value creases and the model's printed copy) as SVG,
 * and return the geometry the brush and the drawing input share. The ink itself is not here:
 * it lives on the canvases above, and every value it shows is also in this SVG's table.
 */
export function renderSheet(
  state: SheetState,
  frame: SheetFrame,
  target: Pick<HTMLElement, "innerHTML">,
  ink: PlayerInk,
): SheetDrawing {
  const { visible, model, real } = state;
  const last = visible.at(-1);
  if (last === undefined) throw new Error("A sheet needs visible history.");
  const domain = chartYDomain(state.yDomain, real, model?.interval);
  const geometry = sheetGeometry(frame, domain);
  const ticks = yTicks(domain);
  const labelled = labelledTicks(ticks, geometry.scale);
  const shown = COLUMNS.filter((column) => frame.columns[column] !== null);
  const withUnit = (value: number) => `${value}${state.unit ? ` ${state.unit}` : ""}`;
  const desc = `Visible 28 days in four weekly columns read from the right: start ${withUnit(visible[0] ?? last)}, end ${withUnit(last)}, minimum ${withUnit(Math.min(...visible))}, maximum ${withUnit(Math.max(...visible))}.`;
  const patternId = `sheet-${state.id.replace(/[^a-zA-Z0-9_-]/gu, "-")}-halftone`;
  let out = `<svg class="chart-svg sheet-svg" role="img" aria-label="${escapeText(state.label)}" viewBox="0 0 ${frame.width} ${frame.height}"><title>${escapeText(state.label)}</title><desc>${escapeText(desc)}</desc>`;
  out += `<defs><pattern id="${patternId}" width="${HALFTONE}" height="${HALFTONE}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><circle class="sheet-dot" cx="${HALFTONE / 2}" cy="${HALFTONE / 2}" r="1.1"/></pattern></defs>`;
  for (const column of shown) {
    const box = geometry.rect(column);
    out += `<path class="sheet-fold" d="${path([
      [box.x, box.y],
      [box.x, box.y + box.height],
    ])}M${coordinate(box.x + box.width)},${coordinate(box.y)}V${coordinate(box.y + box.height)}"/>`;
    for (const tick of ticks) {
      const x = geometry.x(column, tick);
      if (x < box.x || x > box.x + box.width) continue;
      out += `<path class="sheet-crease" d="M${coordinate(x)},${coordinate(box.y)}V${coordinate(box.y + box.height)}"/>`;
      // Every column shares one scale, so the values are written once, over the latest week.
      if (column === "w3" && labelled.includes(tick))
        out += `<text class="sheet-tick" x="${coordinate(x)}" y="${coordinate(box.y - TICK_LABEL_RISE)}" text-anchor="middle">${escapeText(tickLabel(tick))}</text>`;
    }
  }
  // A graphite guide carries the eye from where the given weeks stop to where the brush
  // starts, in one loose stroke: under the last week, up the fold with a slight sway, and
  // over the top into your column, so it stays in the margins and cannot be read as data.
  const [fromX, fromY] = [geometry.x("w3", last), geometry.y("w3", DAYS)];
  const [toX, toY] = [geometry.x("you", last), geometry.y("you", 0)];
  const youRight = geometry.rect("you").x + geometry.rect("you").width;
  const fold = (youRight + geometry.rect("w3").x) / 2;
  const sway = (geometry.rect("w3").x - youRight) * 0.15;
  const [low, high] = [fromY - LINK_MARGIN * 2, toY + LINK_MARGIN * 2];
  out += `<g class="sheet-link">${graphite([
    ...cubic(
      [fromX, fromY + START_RADIUS],
      [fromX, fromY + LINK_MARGIN * 1.5],
      [fold, fromY + LINK_MARGIN],
      [fold, low],
    ),
    ...cubic([fold, low], [fold, low], [fold, high], [fold, high]).map(([x, y]): Point => {
      // An S that leaves and meets the turns square, so the stroke has no kink at either end.
      const along = (low - y) / (low - high);
      return [x + sway * 2 * Math.sin(along * Math.PI * 2) * Math.sin(along * Math.PI), y];
    }),
    ...cubic(
      [fold, high],
      [fold, toY - LINK_MARGIN * 2],
      [toX, toY - LINK_MARGIN * 1.5],
      [toX, toY - START_RADIUS],
    ),
    [toX, toY - START_RADIUS],
  ])}</g>`;
  // Today's value is marked where the given week ends and again where the player's week begins.
  const todayRing = (column: Column, day: number) =>
    `<circle class="sheet-start" cx="${coordinate(geometry.x(column, last))}" cy="${coordinate(geometry.y(column, day))}" r="${START_RADIUS}"/>`;
  out += todayRing("w3", DAYS) + todayRing("you", 0);
  out += `<g data-crowd></g>`;
  if (model) {
    const anchored = (values: readonly number[]): [number, number][] => [
      [geometry.x("ai", last), geometry.y("ai", 0)],
      ...values.map((value, index): [number, number] => [
        geometry.x("ai", value),
        geometry.y("ai", index + 1),
      ]),
    ];
    const upper = anchored(model.interval.upper);
    const lower = anchored(model.interval.lower).slice(1).reverse();
    out += `<path class="sheet-copy-band" fill="url(#${patternId})" d="${path([...upper, ...lower])}Z"/>`;
    out += `<path class="sheet-copy-line" d="${path(anchored(model.median))}"/>`;
    out += anchored(model.median)
      .slice(1)
      .map(
        ([x, y], day) =>
          // A touch of the brush on each day, never quite round.
          `<ellipse class="sheet-copy-day" cx="${coordinate(x)}" cy="${coordinate(y)}" rx="${COPY_DOT + (day % 3) * 0.3}" ry="${COPY_DOT - 0.4}" transform="rotate(${-20 + day * 13} ${coordinate(x)} ${coordinate(y)})"/>`,
      )
      .join("");
  }
  target.innerHTML = `${out}</svg>${historyTable(state)}`;
  const you = geometry.rect("you");
  return {
    geometry,
    region: you,
    orientation: "horizontal",
    lastDay: DAYS,
    pixel: (day, value) => [geometry.x("you", value), geometry.y("you", day)],
    toStroke: (pixelX, pixelY) => ({
      x: geometry.day("you", pixelY),
      y: geometry.value("you", pixelX),
    }),
    player(_svg, values, halfWidth) {
      ink.path(values, halfWidth);
    },
    raw(_svg, points) {
      ink.raw(points);
    },
    crowd(svg, median) {
      const layer = svg.querySelector("[data-crowd]");
      if (!layer) return;
      layer.innerHTML = `<path class="sheet-crowd" d="${path([
        [geometry.x("you", last), geometry.y("you", 0)],
        ...median.map((value, index): [number, number] => [
          geometry.x("you", value),
          geometry.y("you", index + 1),
        ]),
      ])}"/>`;
    },
  };
}

// Building a formatter is slow, so the one formatter is made once.
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const dayMonth = (date: string) => DAY_MONTH.format(new Date(date));

/** "30 Apr to 6 May", or "7 to 13 May" when both ends share a month. */
export function dateRange(first: string, last: string): string {
  const [from, to] = [dayMonth(first), dayMonth(last)];
  const [fromDay, fromMonth] = from.split(" ");
  return fromMonth === to.split(" ")[1] ? `${fromDay} to ${to}` : `${from} to ${to}`;
}

/**
 * Column headings, counted in days from today. A historical puzzle keeps its dates until the
 * answer, or the week could be looked up; the dates then join the series title instead.
 */
export function weekHeads(forecaster: string): [Column, string, string][] {
  return [
    ["w0", "−27 to −21 d", ""],
    ["w1", "−20 to −14 d", ""],
    ["w2", "−13 to −7 d", ""],
    ["w3", "−6 d to today", ""],
    ["you", "Your week", "+1 to +7 d"],
    ["ai", "The AI", forecaster],
  ];
}
