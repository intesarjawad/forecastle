import { expect, test } from "vitest";
import { sampleStroke } from "../../src/core/sampling";

const DAY_XS = [0, 1, 2, 3, 4, 5, 6];
const Y_DOMAIN: readonly [number, number] = [0, 100];
const PERFORMANCE_POINT_COUNT = 2_000;
const SAMPLING_BUDGET_MS = 2;

test("interpolates a straight stroke without changing its samples", () => {
  const points = Object.freeze([Object.freeze({ x: 6, y: 70 }), Object.freeze({ x: -1, y: 0 })]);

  expect(sampleStroke(points, DAY_XS, Y_DOMAIN)).toEqual([10, 20, 30, 40, 50, 60, 70]);
});

test("uses the last sample at each x when the stroke backtracks", () => {
  const points = [
    { x: -1, y: 0 },
    { x: 3, y: 90 },
    { x: 6, y: 70 },
    { x: 3, y: 40 },
    { x: -1, y: 0 },
  ];

  expect(sampleStroke(points, DAY_XS, Y_DOMAIN)).toEqual([10, 20, 30, 40, 50, 60, 70]);
});

test.each([
  { name: "empty stroke", points: [], missing: "start" },
  {
    name: "late start",
    points: [
      { x: 0, y: 10 },
      { x: 6, y: 70 },
    ],
    missing: "start",
  },
  {
    name: "early end",
    points: [
      { x: -1, y: 0 },
      { x: 5.99, y: 70 },
    ],
    missing: "end",
  },
  { name: "single point before start", points: [{ x: -1, y: 10 }], missing: "end" },
  { name: "single point at end", points: [{ x: 6, y: 70 }], missing: "start" },
])("reports the missing edge for a $name", ({ points, missing }) => {
  expect(sampleStroke(points, DAY_XS, Y_DOMAIN)).toEqual({ missing });
});

test("includes the exact start tolerance and final day boundaries", () => {
  expect(
    sampleStroke(
      [
        { x: -0.5, y: 40 },
        { x: 6, y: 40 },
      ],
      DAY_XS,
      Y_DOMAIN,
    ),
  ).toEqual([40, 40, 40, 40, 40, 40, 40]);
  expect(
    sampleStroke(
      [
        { x: -0.49, y: 40 },
        { x: 6, y: 40 },
      ],
      DAY_XS,
      Y_DOMAIN,
    ),
  ).toEqual({ missing: "start" });
});

test("derives the half-day tolerance from the day coordinates", () => {
  expect(
    sampleStroke(
      [
        { x: 9, y: 40 },
        { x: 22, y: 40 },
      ],
      [10, 12, 14, 16, 18, 20, 22],
      Y_DOMAIN,
    ),
  ).toEqual([40, 40, 40, 40, 40, 40, 40]);
});

test.each([-10, 110])("clamps a stroke entirely outside the domain at y = %s", (y) => {
  expect(
    sampleStroke(
      [
        { x: -1, y },
        { x: 6, y },
      ],
      DAY_XS,
      Y_DOMAIN,
    ),
  ).toEqual(Array.from({ length: DAY_XS.length }, () => Math.max(0, Math.min(100, y))));
});

test("clamps after interpolation", () => {
  expect(
    sampleStroke(
      [
        { x: -1, y: -100 },
        { x: 7, y: 140 },
      ],
      DAY_XS,
      [0, 40],
    ),
  ).toEqual([0, 0, 0, 20, 40, 40, 40]);
});

test("samples a 2,000-point stroke in under 2 ms", () => {
  const points = Array.from({ length: PERFORMANCE_POINT_COUNT }, (_, index) => {
    const x = -1 + (8 * ((index * 997) % PERFORMANCE_POINT_COUNT)) / (PERFORMANCE_POINT_COUNT - 1);
    return { x, y: 40 };
  });
  // Best of five isolates the algorithm's cost from unrelated machine load.
  let bestMs = Infinity;
  let sampled: ReturnType<typeof sampleStroke> = [];
  for (let run = 0; run < 5; run += 1) {
    const startedAtMs = performance.now();
    sampled = sampleStroke(points, DAY_XS, Y_DOMAIN);
    bestMs = Math.min(bestMs, performance.now() - startedAtMs);
  }

  expect(sampled).toEqual([40, 40, 40, 40, 40, 40, 40]);
  expect(bestMs).toBeLessThan(SAMPLING_BUDGET_MS);
});
