import type { Interval } from "../core/types";

// Mirrored in Python: ample headroom for differences, sums, k * move and loss normalization.
export const MAX_ABSOLUTE_VALUE = 1e100;
const HORIZON = 7;
const MIN_VISIBLE_VALUES = 2;

export interface ScoringInput {
  readonly visible: readonly number[];
  readonly path: readonly number[];
  readonly interval: Interval;
  readonly actual: readonly number[];
  readonly k: number;
}

/** Reject unaligned or unsafe numeric inputs before calling the pure scoring core. */
export function validateScoringInput(input: ScoringInput): void {
  const series = [
    ["visible", input.visible],
    ["path", input.path],
    ["actual", input.actual],
    ["interval.lower", input.interval.lower],
    ["interval.upper", input.interval.upper],
  ] as const;
  for (const [name, values] of series) {
    const validLength =
      name === "visible" ? values.length >= MIN_VISIBLE_VALUES : values.length === HORIZON;
    if (!validLength) {
      throw new Error(
        name === "visible"
          ? "visible must contain at least 2 values"
          : `${name} must contain 7 values`,
      );
    }
    if (values.some((value) => !Number.isFinite(value) || Math.abs(value) > MAX_ABSOLUTE_VALUE)) {
      throw new Error(`${name} values must be finite with absolute value <= 1e100`);
    }
  }
  if (!Number.isFinite(input.k) || input.k <= 0 || input.k > MAX_ABSOLUTE_VALUE) {
    throw new Error("k must be finite and in (0, 1e100]");
  }
}
