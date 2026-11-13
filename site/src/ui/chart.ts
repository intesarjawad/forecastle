import { placeLineLabels } from "../core/line-labels";
import type { Interval } from "../core/types";
import { chartYDomain, type YDomain } from "../core/y-scale";
import type { DrawSurface } from "./draw";

export type ChartState = {
  /** Unique within the page, including when the same series appears twice. */
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly width: number;
  readonly height: number;
  readonly visible: readonly number[];
  readonly yDomain: YDomain;
  readonly player?: { readonly path: readonly number[]; readonly band: Interval };
  readonly model?: { readonly median: readonly number[]; readonly interval: Interval };
  readonly real?: readonly number[];
  /** All 35 ISO dates, supplied after lock; no date is inferred from the clock. */
  readonly dates?: readonly string[];
  /** Unscored days between history and the seven forecast days, as in a live round. */
  readonly gapDays?: number;
};

type Point = readonly [number, number];
type ChartLayers = {
  querySelector: (selector: string) => Pick<Element, "innerHTML"> | null;
};

export type ChartDrawing = DrawSurface & {
  readonly today: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly dayXs: readonly number[];
  /** Days from today to the right edge, counting any gap: the label the axis ends on. */
  readonly lastDay: number;
  readonly y: (value: number) => number;
  readonly valueAtY: (y: number) => number;
  readonly player: (svg: ChartLayers, values: readonly number[], halfWidth: number) => void;
  readonly raw: (svg: ChartLayers, points: readonly Point[]) => void;
};
type EndLabel = { name: string; ink: string; raw: number; y: number };

const HISTORY_DAYS = 28;
const FORECAST_DAYS = 7;
// SVG geometry uses CSS pixels and matches the chart geometry tokens in :root.
const PLOT_LEFT = 40;
const LABEL_GUTTER = 48;
const PLOT_TOP = 12;
const BOTTOM_OPEN = 40;
const BOTTOM_DATED = 28;
const HISTORY_FRACTION = 0.63;
const LABEL_GAP = 24;
const LABEL_INSET = 12;
const LABEL_BASELINE = 4;
const AXIS_TEXT_OFFSET = 20;
const TICK_LENGTH = 4;
const GESTURE_TIP_WIDTH = 1.2;
const GESTURE_BODY_WIDTH = 4.5;
const GESTURE_WOBBLE = 0.45;
const GESTURE_SAMPLES = 10;

function escapeText(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => `&#${character.charCodeAt(0)};`);
}

const coordinate = (value: number) => Number(value.toFixed(2));
const path = (points: readonly Point[]) =>
  `M${points.map(([x, y]) => `${coordinate(x)},${coordinate(y)}`).join("L")}`;
const line = (points: readonly Point[], style: string) =>
  `<path class="${style}" d="${path(points)}"/>`;
const text = (x: number, y: number, value: string, style = "", anchor = "start") =>
  `<text x="${coordinate(x)}" y="${coordinate(y)}" class="${style}" text-anchor="${anchor}">${escapeText(value)}</text>`;
const shortDate = (date: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(date),
  );

function gesture(points: readonly Point[], id: string): string {
  let seed = [...id].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const center: Point[] = points.slice(0, 1);
  points.slice(1).forEach((b, index) => {
    const a = points[index];
    if (!a) return;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length === 0) return;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const wobble = ((seed / 4294967296) * 2 - 1) * GESTURE_WOBBLE;
    for (let sample = 1; sample <= GESTURE_SAMPLES; sample += 1) {
      const t = sample / GESTURE_SAMPLES;
      const offset = Math.sin(Math.PI * t) * wobble;
      center.push([a[0] + dx * t - (dy / length) * offset, a[1] + dy * t + (dx / length) * offset]);
    }
  });
  const left: Point[] = [];
  const right: Point[] = [];
  center.forEach((point, index) => {
    const a = center[Math.max(0, index - 1)] ?? point;
    const b = center[Math.min(center.length - 1, index + 1)] ?? point;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy) || 1;
    const t = index / Math.max(1, center.length - 1);
    const halfWidth =
      (GESTURE_TIP_WIDTH +
        (GESTURE_BODY_WIDTH - GESTURE_TIP_WIDTH) * Math.sin(Math.PI * t) ** 0.7) /
      2;
    left.push([point[0] - (dy / length) * halfWidth, point[1] + (dx / length) * halfWidth]);
    right.push([point[0] + (dy / length) * halfWidth, point[1] - (dx / length) * halfWidth]);
  });
  return `${path([...left, ...right.reverse()])}Z`;
}

/** 1/2/5 steps near four ticks keep both small units and large counts readable. */
export function yTicks([lower, upper]: YDomain): number[] {
  const target = (upper - lower) / 4;
  const power = 10 ** Math.floor(Math.log10(target));
  const step = ([1, 2, 5, 10].find((multiple) => multiple * power >= target) ?? 10) * power;
  const ticks: number[] = [];
  for (let index = Math.ceil(lower / step); index * step <= upper; index += 1) {
    // Adding zero turns the -0 that Math.ceil gives just below zero into 0, so it prints as "0".
    ticks.push(index * step + 0);
  }
  return ticks;
}

function historyTable(state: ChartState): string {
  const rows = state.visible.map(
    (value, index) =>
      `<tr><th scope="row">${index === 27 ? "today" : `−${27 - index} d`}</th><td>${escapeText(String(value))}</td></tr>`,
  );
  // A table ignores its own size and overflow, so the clipping sits on a wrapper.
  return `<div class="visually-hidden"><table><caption>${escapeText(state.label)}: 28 visible daily values</caption><thead><tr><th scope="col">Day</th><th scope="col">Value${state.unit ? ` (${escapeText(state.unit)})` : ""}</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

/** Replace a chart slot's SVG and accessible table from explicit data and CSS pixel dimensions. */
export function renderChart(
  state: ChartState,
  target: Pick<HTMLElement, "innerHTML">,
): ChartDrawing {
  const { width, height, visible, player, model, real, dates } = state;
  const series = [
    visible,
    player?.path,
    player?.band.lower,
    player?.band.upper,
    model?.median,
    model?.interval.lower,
    model?.interval.upper,
    real,
    dates,
  ];
  series.forEach((values, index) => {
    const expected =
      index === 0 ? HISTORY_DAYS : index === 8 ? HISTORY_DAYS + FORECAST_DAYS : FORECAST_DAYS;
    if (values && values.length !== expected)
      throw new Error(`Chart series requires ${expected} days.`);
  });
  const last = visible.at(-1);
  if (last === undefined) throw new Error("Chart requires visible history.");
  const domain = chartYDomain(state.yDomain, real, model?.interval);
  const right = width - LABEL_GUTTER;
  const bottom = height - (dates ? BOTTOM_DATED : BOTTOM_OPEN);
  if (right <= PLOT_LEFT || bottom - PLOT_TOP < LABEL_GAP * 3) {
    throw new Error("Chart dimensions leave insufficient room for the plot and labels.");
  }
  const today = PLOT_LEFT + (right - PLOT_LEFT) * HISTORY_FRACTION;
  const y = (value: number) =>
    PLOT_TOP + ((domain[1] - value) / (domain[1] - domain[0])) * (bottom - PLOT_TOP);
  const history: Point[] = visible.map((value, index) => [
    PLOT_LEFT + ((today - PLOT_LEFT) * index) / 27,
    y(value),
  ]);
  const origin: Point = [today, y(last)];
  const gapDays = state.gapDays ?? 0;
  const future = (values: readonly number[]): Point[] =>
    values.map((value, index) => [
      today + ((right - today) * (gapDays + index + 1)) / (gapDays + FORECAST_DAYS),
      y(value),
    ]);
  const anchored = (values: readonly number[]) => [origin, ...future(values)];
  const clipId = `chart-${state.id.replace(/[^a-zA-Z0-9_-]/gu, "-")}-bands`;
  const band = (interval: Interval, ink: string) =>
    `<path class="chart-${ink}-band" d="${path([...anchored(interval.upper), ...future(interval.lower).reverse()])}Z"/>`;
  const edges = (interval: Interval, ink: string) =>
    line(anchored(interval.upper), `chart-${ink}-edge`) +
    line(anchored(interval.lower), `chart-${ink}-edge`);
  const withUnit = (value: number) => `${value}${state.unit ? ` ${state.unit}` : ""}`;
  const desc = `Visible 28 days: start ${withUnit(visible[0] ?? last)}, end ${withUnit(last)}, minimum ${withUnit(Math.min(...visible))}, maximum ${withUnit(Math.max(...visible))}.`;
  let out = `<svg class="chart-svg" role="img" aria-label="${escapeText(state.label)}" viewBox="0 0 ${width} ${height}"><title>${escapeText(state.label)}</title><desc>${escapeText(desc)}</desc><rect class="chart-stock" width="${width}" height="${height}"/><defs><clipPath id="${clipId}"><rect x="${PLOT_LEFT}" y="${PLOT_TOP}" width="${right - PLOT_LEFT}" height="${bottom - PLOT_TOP}"/></clipPath></defs>`;
  if (!player && !model && !real)
    out += `<rect class="chart-empty" x="${today}" y="${PLOT_TOP}" width="${right - today}" height="${bottom - PLOT_TOP}"/>`;
  out += `<g clip-path="url(#${clipId})">`;
  // Keep the stock inside the clipped group so the bands overprint the same backdrop when flattened.
  if (model || player)
    out += `<rect class="chart-stock" x="${PLOT_LEFT}" y="${PLOT_TOP}" width="${right - PLOT_LEFT}" height="${bottom - PLOT_TOP}"/>`;
  if (model) out += band(model.interval, "ai");
  out += `<g data-player-band>${player ? band(player.band, "you") : ""}</g>`;
  if (model) out += edges(model.interval, "ai");
  out += `<g data-player-edges>${player ? edges(player.band, "you") : ""}</g>`;
  out += "</g>";
  out += line(
    [
      [PLOT_LEFT, bottom],
      [right, bottom],
    ],
    "chart-axis",
  );
  out += line(
    [
      [today, PLOT_TOP],
      [today, bottom],
    ],
    "chart-today",
  );
  for (const value of yTicks(domain)) {
    out += line(
      [
        [PLOT_LEFT - TICK_LENGTH, y(value)],
        [PLOT_LEFT, y(value)],
      ],
      "chart-axis",
    );
    const label = new Intl.NumberFormat("en-US", {
      maximumSignificantDigits: 3,
      notation: Math.abs(value) >= 10000 ? "compact" : "standard",
    }).format(value);
    out += text(PLOT_LEFT - 8, y(value) + LABEL_BASELINE, label, "", "end");
  }
  for (const offset of [-21, -14, -7, 0, 7]) {
    const x = offset <= 0 ? PLOT_LEFT + ((offset + 27) / 27) * (today - PLOT_LEFT) : right;
    const date = dates?.[offset + 27];
    const label = date
      ? shortDate(date)
      : offset === 0
        ? "today"
        : offset === 7
          ? `+${gapDays + FORECAST_DAYS}`
          : `−${-offset} d`;
    out += line(
      [
        [x, bottom],
        [x, bottom + TICK_LENGTH],
      ],
      "chart-axis",
    );
    out += text(x, bottom + AXIS_TEXT_OFFSET, label, "", "middle");
  }
  out += line(history, "chart-history");
  out += `<g data-player-ink>${player ? `<path class="chart-gesture" d="${gesture(anchored(player.path), state.id)}"/>` : ""}</g>`;
  if (model) out += line(anchored(model.median), "chart-machine");
  if (real) {
    out += `<path class="chart-reality" pathLength="1" d="${path(anchored(real))}"/>`;
    out += future(real)
      .map(
        ([cx, cy]) =>
          `<circle class="chart-day-ring" cx="${coordinate(cx)}" cy="${coordinate(cy)}"/>`,
      )
      .join("");
  }
  const labels: EndLabel[] = [];
  for (const [name, ink, values] of [
    ["You", "you", player?.path],
    ["AI", "ai", model?.median],
    ["Real", "real", real],
  ] as const) {
    const end = values?.at(-1);
    if (end !== undefined) labels.push({ name, ink, raw: y(end), y: y(end) });
  }
  for (const placed of placeLineLabels(
    labels.map((label) => ({ id: label.ink, y: label.y })),
    LABEL_GAP,
    PLOT_TOP + LABEL_INSET,
    bottom - LABEL_INSET,
  )) {
    const original = labels.find((label) => label.ink === placed.id);
    if (!original) throw new Error("Missing line endpoint.");
    const label = { ...original, y: placed.y };
    if (label.ink === "you") out += "<g data-player-label>";
    const x = right + LABEL_INSET;
    out += line(
      [
        [right, label.raw],
        [x, label.y],
      ],
      `chart-connector chart-${label.ink}-connector`,
    );
    out += text(
      x,
      label.y + LABEL_BASELINE,
      label.name,
      `chart-end-label chart-${label.ink}-label`,
    );
    if (label.ink === "you") out += "</g>";
  }
  if (!player) out += "<g data-player-label></g>";
  out += "<g data-draw-idle>";
  if (!player && !model && !real) {
    out += `<circle class="chart-handle" cx="${coordinate(today)}" cy="${coordinate(origin[1])}"/>`;
    // Keep the start instruction inside the plot even when history ends near the top edge.
    out += text(
      today + 12,
      Math.max(PLOT_TOP + 12, origin[1] - 12),
      "Start here",
      "chart-start-label",
    );
    const center = (today + right) / 2;
    out += text(center, bottom - 72, "Draw the", "chart-prompt", "middle");
    out += text(center, bottom - 52, "next 7 days", "chart-prompt", "middle");
  }
  target.innerHTML = `${out}</g></svg>${historyTable(state)}`;
  const replace = (svg: ChartLayers, selector: string, markup: string) => {
    const layer = svg.querySelector(selector);
    if (!layer) throw new Error(`Chart requires ${selector}.`);
    layer.innerHTML = markup;
  };
  const valueAtY = (pixelY: number) =>
    domain[1] - ((pixelY - PLOT_TOP) / (bottom - PLOT_TOP)) * (domain[1] - domain[0]);
  return {
    today,
    right,
    top: PLOT_TOP,
    bottom,
    region: { x: today, y: PLOT_TOP, width: right - today, height: bottom - PLOT_TOP },
    orientation: "vertical",
    pixel: (day, value) => [today + (day / FORECAST_DAYS) * (right - today), y(value)],
    toStroke: (pixelX, pixelY) => ({
      x: (FORECAST_DAYS * (pixelX - today)) / (right - today),
      y: valueAtY(pixelY),
    }),
    dayXs: future(Array.from({ length: FORECAST_DAYS }, () => last)).map(([x]) => x),
    lastDay: gapDays + FORECAST_DAYS,
    y,
    valueAtY,
    player(svg, values, halfWidth) {
      const interval = {
        lower: values.map((value) => value - halfWidth),
        upper: values.map((value) => value + halfWidth),
      };
      replace(svg, "[data-player-band]", band(interval, "you"));
      replace(svg, "[data-player-edges]", edges(interval, "you"));
      replace(
        svg,
        "[data-player-ink]",
        `<path class="chart-gesture" d="${gesture(anchored(values), state.id)}"/>`,
      );
      const end = values.at(-1);
      if (end !== undefined) {
        const labelY = Math.max(PLOT_TOP + LABEL_INSET, Math.min(bottom - LABEL_INSET, y(end)));
        replace(
          svg,
          "[data-player-label]",
          line(
            [
              [right, y(end)],
              [right + LABEL_INSET, labelY],
            ],
            "chart-connector chart-you-connector",
          ) +
            text(
              right + LABEL_INSET,
              labelY + LABEL_BASELINE,
              "You",
              "chart-end-label chart-you-label",
            ),
        );
      }
    },
    raw(svg, points) {
      replace(
        svg,
        "[data-player-ink]",
        `<path class="chart-gesture" d="${gesture([origin, ...points], state.id)}"/>`,
      );
    },
  };
}

/** The same chart with drawing confined to the days from startX to the right edge. */
export function drawFrom(chart: ChartDrawing, startX: number): DrawSurface {
  const width = chart.right - startX;
  return {
    ...chart,
    region: { ...chart.region, x: startX, width },
    pixel: (day, value) => [startX + (day / FORECAST_DAYS) * width, chart.y(value)],
    toStroke: (pixelX, pixelY) => ({
      x: (FORECAST_DAYS * (pixelX - startX)) / width,
      y: chart.valueAtY(pixelY),
    }),
  };
}
