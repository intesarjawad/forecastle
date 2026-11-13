import { expect, test } from "vitest";
import { submitRate } from "../../src/core/rate";

const schedule = [{ from: "2026-12-01", to: "2026-12-05", rate: 0.25 }];

test.each([
  ["2026-11-30", 1],
  ["2026-12-01", 0.25],
  ["2026-12-05", 0.25],
  ["2026-12-06", 1],
] as const)("uses inclusive UTC boundaries on %s", (date, expected) => {
  expect(submitRate(schedule, date)).toBe(expected);
});

test("an empty schedule sends every daily play", () => {
  expect(submitRate([], "2026-12-01")).toBe(1);
});
