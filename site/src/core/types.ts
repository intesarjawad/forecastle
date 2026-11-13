/** Pointwise interval bounds aligned with the forecast days. */
export type Interval = {
  readonly lower: readonly number[];
  readonly upper: readonly number[];
};

/** A day's error category relative to the visible series' typical move. */
export type Cell = "green" | "yellow" | "white";
