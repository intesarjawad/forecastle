import { isCalendarDate } from "../core/dates";
import { type PuzzleIndex, parseForecast } from "./puzzle-validation";

const HORIZON = 7;
const VISIBLE_DAYS = 28;
const MAX_ABSOLUTE_VALUE = 1e100;

type RecordValue = Record<string, unknown>;

export type LiveEntry = PuzzleIndex["live"][number];

export type LivePuzzle = {
  readonly id: string;
  readonly number: number;
  readonly seriesId: string;
  readonly label: string;
  readonly unit: string;
  readonly visible: readonly number[];
  readonly typicalMove: number;
  readonly yDomain: readonly [number, number];
  readonly horizon: 7;
  readonly gapDays: number;
  readonly forecastSha256: string;
  readonly opensUtc: string;
  readonly cutoffUtc: string;
  readonly resolvesUtc: string;
  readonly scoredDates: readonly string[];
};

export type LiveForecast = {
  readonly forecaster: string;
  readonly revision: string;
  readonly median: readonly number[];
  readonly q10: readonly number[];
  readonly q90: readonly number[];
};

export type LiveCrowd = {
  readonly count: number;
  readonly median: readonly number[];
  readonly p10: readonly number[];
  readonly p90: readonly number[];
};

export type LiveAnswer = {
  readonly dates: readonly string[];
  readonly actual: readonly number[];
  readonly crowd?: LiveCrowd;
};

export type LiveTableRow = {
  readonly date: string;
  readonly ai?: number;
  readonly crowd?: number;
  readonly actual?: number;
};

export type LiveGeometry = {
  readonly today: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly y: (value: number) => number;
};

function record(value: unknown): RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Expected an object.");
  return value as RecordValue;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new Error("Invalid text field.");
  return value;
}

function numeric(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > MAX_ABSOLUTE_VALUE)
    throw new Error("Invalid numeric field.");
  return value;
}

function numbers(value: unknown, length: number): number[] {
  if (!Array.isArray(value) || value.length !== length) throw new Error("Invalid array length.");
  return Array.from(value, numeric);
}

function integer(value: unknown): number {
  const number = numeric(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error("Expected a whole number.");
  return number;
}

function dateText(value: unknown): string {
  const result = text(value);
  if (!isCalendarDate(result)) throw new Error("Invalid calendar date.");
  return result;
}

function utcText(value: unknown): string {
  const result = text(value);
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|\+00:00)$/u.test(result))
    throw new Error("Invalid UTC timestamp.");
  dateText(result.slice(0, 10));
  return result;
}

function digest(value: unknown): string {
  const result = text(value);
  if (!/^[a-f0-9]{64}$/u.test(result)) throw new Error("Invalid forecast digest.");
  return result;
}

const PUZZLE_KEYS = [
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
  "forecastSha256",
  "opensUtc",
  "cutoffUtc",
  "resolvesUtc",
  "scoredDates",
] as const;

/** Validate a sealed live chart at the boundary; the answer and forecast are separate files. */
export function parseLivePuzzle(value: unknown): LivePuzzle {
  const input = record(value);
  if (
    PUZZLE_KEYS.some((key) => !(key in input)) ||
    Object.keys(input).some(
      (key) => !(PUZZLE_KEYS as readonly string[]).includes(key) && key !== "cutoffForecastSha256",
    )
  )
    throw new Error("Unexpected or missing fields.");
  const domain = numbers(input.yDomain, 2);
  const lower = domain[0];
  const upper = domain[1];
  if (lower === undefined || upper === undefined || lower >= upper)
    throw new Error("Invalid live puzzle geometry.");
  if (input.kind !== "prospective" || input.horizon !== HORIZON)
    throw new Error("Invalid live puzzle kind.");
  const number = integer(input.number);
  if (number < 1) throw new Error("Expected a positive chart number.");
  const typicalMove = numeric(input.typicalMove);
  if (typicalMove <= 0) throw new Error("Expected a positive typical move.");
  const gapDays = integer(input.gapDays);
  const visible = numbers(input.visible, VISIBLE_DAYS);
  const scoredDates = Array.isArray(input.scoredDates)
    ? Array.from(input.scoredDates, dateText)
    : [];
  if (
    scoredDates.length !== HORIZON ||
    scoredDates.some((day, index) => {
      const previous = scoredDates[index - 1];
      return previous !== undefined && Date.parse(day) - Date.parse(previous) !== 86_400_000;
    })
  )
    throw new Error("Live charts require seven consecutive scored dates.");
  const opensUtc = utcText(input.opensUtc);
  const cutoffUtc = utcText(input.cutoffUtc);
  const resolvesUtc = utcText(input.resolvesUtc);
  if (
    Date.parse(opensUtc) >= Date.parse(cutoffUtc) ||
    Date.parse(cutoffUtc) >= Date.parse(resolvesUtc)
  )
    throw new Error("Invalid live round window.");
  if (input.cutoffForecastSha256 !== undefined) digest(input.cutoffForecastSha256);
  return {
    id: text(input.id),
    number,
    seriesId: text(input.seriesId),
    label: text(input.label),
    unit: typeof input.unit === "string" ? input.unit : "",
    visible,
    typicalMove,
    yDomain: [lower, upper],
    horizon: HORIZON,
    gapDays,
    forecastSha256: digest(input.forecastSha256),
    opensUtc,
    cutoffUtc,
    resolvesUtc,
    scoredDates,
  };
}

/** The published forecast carries comparison rows, so only the shared quantiles cross the boundary. */
export function parseLiveForecast(value: unknown): LiveForecast {
  const input = record(value);
  return parseForecast({
    forecaster: input.forecaster,
    revision: input.revision,
    median: input.median,
    q10: input.q10,
    q90: input.q90,
  });
}

function crowd(value: unknown): LiveCrowd {
  const input = record(value);
  const median = numbers(input.median, HORIZON);
  const p10 = numbers(input.p10, HORIZON);
  const p90 = numbers(input.p90, HORIZON);
  for (let day = 0; day < HORIZON; day += 1) {
    const low = p10[day];
    const middle = median[day];
    const high = p90[day];
    if (low === undefined || middle === undefined || high === undefined)
      throw new Error("Invalid crowd path.");
    if (low > middle || middle > high) throw new Error("Crossed crowd quantiles.");
  }
  return { count: integer(input.count), median, p10, p90 };
}

/** A live answer holds the seven scored days; a daily answer also carries visible dates. */
export function parseLiveAnswer(value: unknown, id: string): LiveAnswer {
  const input = record(value);
  if (input.id !== id) throw new Error("Answer id does not match its puzzle.");
  const actual = numbers(input.actual, HORIZON);
  if (!Array.isArray(input.dates) || (input.dates.length !== HORIZON && input.dates.length !== 35))
    throw new Error("Answer requires seven scored dates.");
  const dates = Array.from(input.dates, dateText);
  if (
    dates
      .slice(1)
      .some((day, index) => Date.parse(day) - Date.parse(dates[index] ?? "") !== 86_400_000)
  )
    throw new Error("Answer dates must be consecutive days.");
  const scored = dates.slice(-HORIZON);
  return {
    dates: scored,
    actual,
    ...(input.crowd === undefined ? {} : { crowd: crowd(input.crowd) }),
  };
}
