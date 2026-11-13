import type { Interval } from "./types";

export type YDomain = readonly [number, number];

const REVEAL_PADDING_FRACTION = 0.05;

/**
 * Keep the drawing domain unless reality or the model interval exceeds it.
 * Only exceeded edges get 5% padding of the combined span; untouched edges stay fixed.
 */
export function chartYDomain(
  domain: YDomain,
  real: readonly number[] = [],
  model?: Interval,
): YDomain {
  const lower = Math.min(domain[0], ...real, ...(model?.lower ?? []));
  const upper = Math.max(domain[1], ...real, ...(model?.upper ?? []));
  const padding = (upper - lower) * REVEAL_PADDING_FRACTION;
  return [
    lower < domain[0] ? lower - padding : domain[0],
    upper > domain[1] ? upper + padding : domain[1],
  ];
}
