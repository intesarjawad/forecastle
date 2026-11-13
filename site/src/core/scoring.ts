import type { Cell, Interval } from "./types";

// io/scoring validates alignment and finite magnitudes <= 1e100 before scoring.
const MAX_CLOSENESS = 100;
const TYPICAL_MOVE_RANGE_FRACTION = 0.01;
const YELLOW_MOVE_MULTIPLIER = 2;
const LOWER_QUANTILE = 0.1;
const MEDIAN_QUANTILE = 0.5;
const UPPER_QUANTILE = 0.9;
const QUANTILE_COUNT = 3;

/** Mean absolute daily change, floored by 1% of the range and machine epsilon. */
export function typicalMove(visible: readonly number[]): number {
  const differences = visible
    .slice(1)
    .map((value, index) => Math.abs(value - (visible[index] ?? value)));
  const mean = differences.reduce((sum, difference) => sum + difference, 0) / differences.length;
  const range = Math.max(...visible) - Math.min(...visible);
  return Math.max(mean, TYPICAL_MOVE_RANGE_FRACTION * range, Number.EPSILON);
}

/** Rounded score from 0 to 100, reaching zero at MAE = k times the typical move. */
export function closeness(
  path: readonly number[],
  actual: readonly number[],
  move: number,
  k: number,
): number {
  const mae =
    path.reduce((sum, value, index) => sum + Math.abs(value - (actual[index] ?? 0)), 0) /
    actual.length;
  return Math.round(MAX_CLOSENESS * Math.max(0, 1 - mae / (k * move)));
}

/** Green includes one typical move; yellow includes two. */
export function dayCells(path: readonly number[], actual: readonly number[], move: number): Cell[] {
  return actual.map((value, index) => {
    const error = Math.abs((path[index] ?? 0) - value);
    return error <= move ? "green" : error <= YELLOW_MOVE_MULTIPLIER * move ? "yellow" : "white";
  });
}

/** Number of actual values within the interval, including its edges. */
export function coverage(interval: Interval, actual: readonly number[]): number {
  return actual.filter(
    (value, index) =>
      value >= (interval.lower[index] ?? Infinity) && value <= (interval.upper[index] ?? -Infinity),
  ).length;
}

/** Mean interval width plus miss penalties; alpha is the excluded probability. */
export function winkler(interval: Interval, actual: readonly number[], alpha: number): number {
  const perDay = actual.map((value, index) => {
    const lower = interval.lower[index] ?? 0;
    const upper = interval.upper[index] ?? 0;
    const width = upper - lower;
    if (value < lower) return width + (2 / alpha) * (lower - value);
    if (value > upper) return width + (2 / alpha) * (value - upper);
    return width;
  });
  return perDay.reduce((sum, loss) => sum + loss, 0) / perDay.length;
}

/** Mean pinball loss over days and the 0.1, 0.5 and 0.9 quantiles. */
export function quantileLoss(
  path: readonly number[],
  interval: Interval,
  actual: readonly number[],
): number {
  const pinball = (quantile: number, forecast: number, value: number) =>
    Math.max(quantile * (value - forecast), (quantile - 1) * (value - forecast));
  const perDay = actual.map(
    (value, index) =>
      (pinball(LOWER_QUANTILE, interval.lower[index] ?? 0, value) +
        pinball(MEDIAN_QUANTILE, path[index] ?? 0, value) +
        pinball(UPPER_QUANTILE, interval.upper[index] ?? 0, value)) /
      QUANTILE_COUNT,
  );
  return perDay.reduce((sum, loss) => sum + loss, 0) / perDay.length;
}
