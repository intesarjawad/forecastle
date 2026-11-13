import { expect, test } from "vitest";
import { type DrawState, keyboardDrawValue, mergeDrawStroke } from "../../src/ui/draw";

const EMPTY: DrawState = { points: [], values: null, missing: null };
const DOMAIN: readonly [number, number] = [0, 100];
const STRAIGHT = [
  { x: 0, y: 0 },
  { x: 7, y: 70 },
];

test("a partial replacement changes only the days it spans", () => {
  const original = mergeDrawStroke(EMPTY, STRAIGHT, 0, DOMAIN);
  const before = JSON.stringify(original);
  const result = mergeDrawStroke(
    original,
    [
      { x: 2.5, y: 80 },
      { x: 4.5, y: 100 },
    ],
    0,
    DOMAIN,
  );
  // Half a day into the two-day segment gives 85; one and a half gives 95.
  expect(result.values).toEqual([10, 20, 85, 95, 50, 60, 70]);
  expect(result.missing).toBeNull();
  expect(JSON.stringify(original)).toBe(before);
});

test("a replacement clamps its days without moving neighbouring days", () => {
  const original = mergeDrawStroke(EMPTY, STRAIGHT, 0, DOMAIN);
  const above = mergeDrawStroke(
    original,
    [
      { x: 2.5, y: 120 },
      { x: 4.5, y: 140 },
    ],
    0,
    DOMAIN,
  );
  expect(above.values).toEqual([10, 20, 100, 100, 50, 60, 70]);
  const below = mergeDrawStroke(
    above,
    [
      { x: 4.5, y: -20 },
      { x: 2.5, y: -40 },
    ],
    0,
    DOMAIN,
  );
  expect(below.values).toEqual([10, 20, 0, 0, 50, 60, 70]);
});

test("an unfinished mark keeps its samples and can be continued to the final day", () => {
  const partial = mergeDrawStroke(
    EMPTY,
    [
      { x: 0, y: 0 },
      { x: 3, y: 30 },
    ],
    0,
    DOMAIN,
  );
  expect(partial.missing).toBe("end");
  expect(partial.values).toBeNull();
  expect(partial.points).toEqual([
    { x: 0, y: 0 },
    { x: 3, y: 30 },
  ]);
  expect(
    mergeDrawStroke(
      partial,
      [
        { x: 3, y: 30 },
        { x: 7, y: 70 },
      ],
      0,
      DOMAIN,
    ).values,
  ).toEqual([10, 20, 30, 40, 50, 60, 70]);
});

test("a late start can be filled without losing the later days", () => {
  const partial = mergeDrawStroke(
    EMPTY,
    [
      { x: 3, y: 30 },
      { x: 7, y: 70 },
    ],
    0,
    DOMAIN,
  );
  expect(partial.missing).toBe("start");
  expect(
    mergeDrawStroke(
      partial,
      [
        { x: 0, y: 0 },
        { x: 3, y: 30 },
      ],
      0,
      DOMAIN,
    ).values,
  ).toEqual([10, 20, 30, 40, 50, 60, 70]);
});

test("repeated positions use the last value and an empty stroke preserves state", () => {
  expect(
    mergeDrawStroke(
      EMPTY,
      [
        { x: 0, y: 0 },
        { x: 7, y: 90 },
        { x: 7, y: 70 },
      ],
      0,
      DOMAIN,
    ).values,
  ).toEqual([10, 20, 30, 40, 50, 60, 70]);
  expect(mergeDrawStroke(EMPTY, [], 0, DOMAIN)).toBe(EMPTY);
});

test.each([
  { key: "ArrowUp", shift: false, expected: 15 },
  { key: "ArrowDown", shift: false, expected: 9 },
  { key: "ArrowUp", shift: true, expected: 24 },
  { key: "ArrowDown", shift: true, expected: 0 },
  { key: "Home", shift: false, expected: -10 },
  { key: "End", shift: false, expected: 30 },
  { key: "Tab", shift: false, expected: null },
  { key: "ArrowLeft", shift: false, expected: null },
])("keyboard $key with shift=$shift yields $expected", ({ key, shift, expected }) => {
  // Starting at 12 with a typical move of 6: normal steps are 3, shifted steps are 12.
  expect(keyboardDrawValue(12, key, shift, 6, [-10, 30])).toBe(expected);
});

test("keyboard steps stop at both bounds", () => {
  expect(keyboardDrawValue(29, "ArrowUp", false, 6, [-10, 30])).toBe(30);
  expect(keyboardDrawValue(-9, "ArrowDown", true, 6, [-10, 30])).toBe(-10);
});

test("on a sideways sheet, right and left move the value too", () => {
  expect(keyboardDrawValue(12, "ArrowRight", false, 6, [-10, 30], "horizontal")).toBe(15);
  expect(keyboardDrawValue(12, "ArrowLeft", true, 6, [-10, 30], "horizontal")).toBe(0);
  expect(keyboardDrawValue(12, "ArrowRight", false, 6, [-10, 30])).toBeNull();
});
