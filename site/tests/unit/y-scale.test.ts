import { expect, test } from "vitest";
import { chartYDomain } from "../../src/core/y-scale";

test("idle, contained values and exact edges preserve the puzzle domain", () => {
  expect(chartYDomain([10, 30])).toEqual([10, 30]);
  expect(chartYDomain([10, 30], [10, 20, 30], { lower: [10], upper: [30] })).toEqual([10, 30]);
});

test("an upper excursion pads the new 40-unit span by two", () => {
  expect(chartYDomain([10, 30], [50])).toEqual([10, 52]);
});

test("a lower model excursion pads the new 40-unit span by two", () => {
  expect(chartYDomain([10, 30], [], { lower: [-10], upper: [25] })).toEqual([-12, 30]);
});

test("both excursions share the combined 80-unit span and four-unit padding", () => {
  expect(chartYDomain([10, 30], [60], { lower: [-20], upper: [45] })).toEqual([-24, 64]);
});

test("a twentyfold spike stays inside the extended domain", () => {
  expect(chartYDomain([0, 10], [200])).toEqual([0, 210]);
});
