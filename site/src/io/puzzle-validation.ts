import { isCalendarDate } from "../core/dates";
import { MAX_ABSOLUTE_VALUE } from "./scoring";

const VISIBLE_DAYS = 28;
const HORIZON = 7;

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected an object.");
  }
  return value as RecordValue;
}

function keys(value: RecordValue, expected: readonly string[]): void {
  if (Object.keys(value).length !== expected.length || expected.some((key) => !(key in value))) {
    throw new Error("Unexpected or missing fields.");
  }
}

function text(value: unknown, max = Number.POSITIVE_INFINITY, min = 1): string {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    throw new Error("Invalid text field.");
  }
  return value;
}

function numeric(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > MAX_ABSOLUTE_VALUE
  ) {
    throw new Error("Invalid numeric field.");
  }
  return value;
}

function positiveInteger(value: unknown): number {
  const number = numeric(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error("Expected a positive integer.");
  return number;
}

function numbers(value: unknown, length: number): number[] {
  if (!Array.isArray(value) || value.length !== length) throw new Error("Invalid array length.");
  return Array.from(value, numeric);
}

function date(value: unknown): string {
  const result = text(value);
  if (!isCalendarDate(result)) throw new Error("Invalid calendar date.");
  return result;
}

function historical(value: unknown): "historical" {
  if (value !== "historical") throw new Error("Expected a historical puzzle.");
  return value;
}

/** Validate the shared forecast shape without accepting hidden answer fields. */
export function parseForecast(value: unknown) {
  const input = record(value);
  keys(input, ["forecaster", "revision", "median", "q10", "q90"]);
  const median = numbers(input.median, HORIZON);
  const q10 = numbers(input.q10, HORIZON);
  const q90 = numbers(input.q90, HORIZON);
  for (let day = 0; day < HORIZON; day += 1) {
    const lower = q10[day];
    const middle = median[day];
    const upper = q90[day];
    if (
      lower === undefined ||
      middle === undefined ||
      upper === undefined ||
      lower > middle ||
      middle > upper
    ) {
      throw new Error("Crossed forecast quantiles.");
    }
  }
  return { forecaster: text(input.forecaster), revision: text(input.revision), median, q10, q90 };
}

/** Parse a daily puzzle at the network boundary; reject dates and answers in its body. */
export function parsePuzzle(value: unknown) {
  const input = record(value);
  keys(input, [
    "id",
    "number",
    "kind",
    "seriesId",
    "label",
    "unit",
    "visible",
    "typicalMove",
    "yDomain",
    "horizon",
    "gapDays",
    "ai",
    "forecastSha256",
  ]);
  const domain = numbers(input.yDomain, 2);
  const lower = domain[0];
  const upper = domain[1];
  const typicalMove = numeric(input.typicalMove);
  if (
    lower === undefined ||
    upper === undefined ||
    lower >= upper ||
    typicalMove <= 0 ||
    input.horizon !== HORIZON ||
    input.gapDays !== 0
  ) {
    throw new Error("Invalid daily puzzle geometry.");
  }
  const forecastSha256 = text(input.forecastSha256);
  if (!/^[a-f0-9]{64}$/.test(forecastSha256)) throw new Error("Invalid forecast digest.");
  const yDomain: readonly [number, number] = [lower, upper];
  return {
    id: date(input.id),
    number: positiveInteger(input.number),
    kind: historical(input.kind),
    seriesId: text(input.seriesId),
    label: text(input.label, 80),
    unit: text(input.unit, 16, 0),
    visible: numbers(input.visible, VISIBLE_DAYS),
    typicalMove,
    yDomain,
    horizon: HORIZON,
    gapDays: 0,
    ai: parseForecast(input.ai),
    forecastSha256,
  };
}

function timestamp(value: unknown): string {
  const result = text(value);
  if (
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|\+00:00)$/.test(result) ||
    !Number.isFinite(Date.parse(result))
  ) {
    throw new Error("Invalid UTC timestamp.");
  }
  date(result.slice(0, 10));
  return result;
}

/** Validate archive entries and live-round metadata before choosing a fallback. */
export function parsePuzzleIndex(value: unknown) {
  const input = record(value);
  keys(input, ["launchDate", "puzzles", "live"]);
  if (!Array.isArray(input.puzzles) || !Array.isArray(input.live))
    throw new Error("Invalid index arrays.");
  const launchDate = date(input.launchDate);
  const puzzles = Array.from(input.puzzles, (value: unknown) => {
    const entry = record(value);
    keys(entry, ["id", "number", "kind", "label"]);
    const id = date(entry.id);
    if (id < launchDate) throw new Error("Puzzle precedes launch.");
    return {
      id,
      number: positiveInteger(entry.number),
      kind: historical(entry.kind),
      label: text(entry.label, 80),
    };
  });
  const live = Array.from(input.live, (value: unknown) => {
    const entry = record(value);
    keys(entry, ["id", "charts", "opensUtc", "cutoffUtc", "resolvesUtc", "resolved"]);
    const id = text(entry.id);
    if (!id.startsWith("live-")) throw new Error("Invalid live round id.");
    date(id.slice(5));
    const opensUtc = timestamp(entry.opensUtc);
    const cutoffUtc = timestamp(entry.cutoffUtc);
    const resolvesUtc = timestamp(entry.resolvesUtc);
    if (
      entry.charts !== 3 ||
      typeof entry.resolved !== "boolean" ||
      Date.parse(opensUtc) >= Date.parse(cutoffUtc) ||
      Date.parse(cutoffUtc) >= Date.parse(resolvesUtc)
    ) {
      throw new Error("Invalid live round metadata.");
    }
    return { id, charts: entry.charts, opensUtc, cutoffUtc, resolvesUtc, resolved: entry.resolved };
  });
  if (
    new Set(puzzles.map(({ id }) => id)).size !== puzzles.length ||
    new Set(live.map(({ id }) => id)).size !== live.length
  )
    throw new Error("Duplicate index ids.");
  return { launchDate, puzzles, live };
}

export type Puzzle = ReturnType<typeof parsePuzzle>;
export type PuzzleIndex = ReturnType<typeof parsePuzzleIndex>;
