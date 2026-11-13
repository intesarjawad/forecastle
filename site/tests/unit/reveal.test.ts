import { expect, test } from "vitest";
import { revealProgress } from "../../src/ui/reveal";

test("the reveal holds before each delay and reaches the final frame at its duration", () => {
  expect(revealProgress(999, 1000, 200)).toBe(0);
  expect(revealProgress(1000, 1000, 200)).toBe(0);
  expect(revealProgress(1200, 1000, 200)).toBe(1);
  expect(revealProgress(2500, 1000, 200)).toBe(1);
});

test("uses the time coordinate of the specified easing curve", () => {
  // Bezier parameter t=0.5 gives x=0.33125 and y=0.875.
  expect(revealProgress(1331.25, 1000, 1000)).toBeCloseTo(0.875, 5);
});
