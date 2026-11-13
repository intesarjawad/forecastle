import { expect, test } from "vitest";
import { fitsPuzzle, parsePuzzle, parseSubmission, validPuzzleId } from "../src/validate";

const NOW = Date.parse("2026-11-05T23:59:59Z");
const ENTRY = {
  puzzleId: "2026-11-05",
  clientId: "00112233-4455-4677-8899-aabbccddeeff",
  path: [1, 2, 3, 4, 5, 6, 7],
  halfWidth: 1,
  msToLock: 0,
};

test.each([NaN, Infinity, -Infinity])("nonfinite path or halfWidth %s is rejected", (value) => {
  expect(parseSubmission({ ...ENTRY, path: [1, 2, 3, value, 5, 6, 7] }, NOW)).toBeNull();
  expect(parseSubmission({ ...ENTRY, halfWidth: value }, NOW)).toBeNull();
  expect(parseSubmission({ ...ENTRY, msToLock: value }, NOW)).toBeNull();
});

test.each(["2026-11-04", "2026-11-05", "2026-11-06"])(
  "daily UTC window includes %s",
  (puzzleId) => {
    expect(parseSubmission({ ...ENTRY, puzzleId }, NOW)).not.toBeNull();
    expect(
      parseSubmission({ ...ENTRY, puzzleId }, Date.parse("2026-11-05T00:00:00Z")),
    ).not.toBeNull();
  },
);

test.each(["2026-11-03", "2026-11-07"])("daily UTC window excludes %s", (puzzleId) => {
  expect(parseSubmission({ ...ENTRY, puzzleId }, NOW)).toBeNull();
});

test("valid live ids have no daily date window", () => {
  expect(parseSubmission({ ...ENTRY, puzzleId: "live-2026-10-01-3" }, NOW)).not.toBeNull();
  expect(validPuzzleId("live-2026-02-30-1")).toBe(false);
  expect(validPuzzleId("2024-02-29")).toBe(true);
  expect(validPuzzleId("2026-02-29")).toBe(false);
});

test("path bounds are inclusive and come from the puzzle", () => {
  const puzzle = { yDomain: [1, 7], typicalMove: 2 };
  expect(fitsPuzzle(ENTRY, puzzle)).toBe(true);
  expect(fitsPuzzle({ ...ENTRY, path: [0, 2, 3, 4, 5, 6, 7] }, puzzle)).toBe(false);
  expect(fitsPuzzle({ ...ENTRY, path: [1, 2, 3, 4, 5, 6, 8] }, puzzle)).toBe(false);
});

test("puzzle files must identify the requested puzzle and provide valid bounds", () => {
  const puzzle = { id: ENTRY.puzzleId, yDomain: [-10, 10], typicalMove: 2 };
  expect(parsePuzzle(puzzle, ENTRY.puzzleId)).not.toBeNull();
  expect(parsePuzzle({ ...puzzle, id: "2026-11-04" }, ENTRY.puzzleId)).toBeNull();
  expect(parsePuzzle({ ...puzzle, yDomain: [10, -10] }, ENTRY.puzzleId)).toBeNull();
  expect(parsePuzzle({ ...puzzle, typicalMove: Infinity }, ENTRY.puzzleId)).toBeNull();
  expect(parsePuzzle({ ...puzzle, id: "live-2026-11-02-1" }, "live-2026-11-02-1")).toBeNull();
});
