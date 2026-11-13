const START_TOLERANCE_DAY_FRACTION = 0.5;

/** Interpolate daily values from the last sample at each x, clamped to the domain. */
export function sampleStroke(
  points: readonly { x: number; y: number }[],
  dayXs: readonly number[],
  yDomain: readonly [number, number],
): number[] | { missing: "start" | "end" } {
  const samplesByX = new Map(points.map(({ x, y }) => [x, y]));
  const samples = Array.from(samplesByX, ([x, y]) => ({ x, y })).sort((a, b) => a.x - b.x);
  const first = samples[0];
  const last = samples.at(-1);
  const firstDayX = dayXs[0];
  const lastDayX = dayXs.at(-1);
  if (first === undefined || firstDayX === undefined) return { missing: "start" };

  const dayWidth = (dayXs[1] ?? firstDayX) - firstDayX;
  const tolerance = START_TOLERANCE_DAY_FRACTION * dayWidth;
  if (first.x > firstDayX - tolerance) return { missing: "start" };
  if (last === undefined || lastDayX === undefined || last.x < lastDayX) {
    return { missing: "end" };
  }

  let index = 0;
  return dayXs.map((dayX) => {
    let upper = samples[index + 1];
    while (upper !== undefined && upper.x <= dayX) {
      index += 1;
      upper = samples[index + 1];
    }
    const lower = samples[index] ?? first;
    const y =
      upper === undefined
        ? lower.y
        : lower.y + ((dayX - lower.x) / (upper.x - lower.x)) * (upper.y - lower.y);
    return Math.max(yDomain[0], Math.min(yDomain[1], y));
  });
}
