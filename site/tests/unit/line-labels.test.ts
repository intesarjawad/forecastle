import { expect, test } from "vitest";
import { placeLineLabels } from "../../src/core/line-labels";

test("keeps separated endpoints and leaves the supplied array intact", () => {
  const ends = [
    { id: "Real", y: 200 },
    { id: "You", y: 30 },
    { id: "AI", y: 90 },
  ];
  const before = JSON.stringify(ends);
  expect(placeLineLabels(ends, 24, 12, 240)).toEqual([
    { id: "You", y: 30 },
    { id: "AI", y: 90 },
    { id: "Real", y: 200 },
  ]);
  expect(JSON.stringify(ends)).toBe(before);
});

test.each([
  [
    [0, 0, 0],
    [12, 36, 60],
  ],
  [
    [230, 239, 240],
    [192, 216, 240],
  ],
  [
    [100, 102, 104],
    [100, 124, 148],
  ],
  [
    [100, 100, 100],
    [100, 124, 148],
  ],
])("nudges endpoint centres %j to %j", (ys, expected) => {
  expect(
    placeLineLabels(
      ys.map((y, index) => ({ id: String(index), y })),
      24,
      12,
      240,
    ).map(({ y }) => y),
  ).toEqual(expected);
});

test("handles empty and single labels, outlying endpoints, and exact capacity", () => {
  expect(placeLineLabels([], 24, 12, 240)).toEqual([]);
  expect(placeLineLabels([{ id: "You", y: -100 }], 24, 12, 240)).toEqual([{ id: "You", y: 12 }]);
  expect(placeLineLabels([{ id: "You", y: 500 }], 24, 12, 240)).toEqual([{ id: "You", y: 240 }]);
  expect(
    placeLineLabels(
      [
        { id: "You", y: 500 },
        { id: "AI", y: 500 },
      ],
      24,
      12,
      36,
    ),
  ).toEqual([
    { id: "You", y: 12 },
    { id: "AI", y: 36 },
  ]);
  expect(() =>
    placeLineLabels(
      [
        { id: "You", y: 0 },
        { id: "AI", y: 0 },
      ],
      24,
      0,
      23,
    ),
  ).toThrow("Insufficient room");
});
