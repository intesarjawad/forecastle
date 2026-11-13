import { expect, test } from "vitest";
import goldenCases from "../../../scoring/golden.json";
import {
  closeness,
  coverage,
  dayCells,
  quantileLoss,
  typicalMove,
  winkler,
} from "../../src/core/scoring";
import { validateScoringInput } from "../../src/io/scoring";

const INTERVAL_ALPHA = 0.2;
const NUMERIC_TOLERANCE = 1e-12;

test.each([Infinity, -Infinity, NaN, 1.0000000000000002e100, -1.0000000000000002e100])(
  "rejects an unsafe path value %s at ingestion",
  (value) => {
    expect(() =>
      validateScoringInput({
        visible: [0, 1],
        path: Array.from({ length: 7 }, () => value),
        actual: [0, 0, 0, 0, 0, 0, 0],
        interval: { lower: [0, 0, 0, 0, 0, 0, 0], upper: [1, 1, 1, 1, 1, 1, 1] },
        k: 4,
      }),
    ).toThrow("path values must be finite with absolute value <= 1e100");
  },
);

test.each(goldenCases)("$name", (scoringCase) => {
  if (scoringCase.error !== undefined) {
    expect(() => validateScoringInput(scoringCase)).toThrow(scoringCase.error);
    return;
  }
  validateScoringInput(scoringCase);
  const { visible, path, interval, actual, k, expected } = scoringCase;
  const move = typicalMove(visible);

  expect(move).toBe(expected.typicalMove);
  expect(closeness(path, actual, move, k)).toBe(expected.closeness);
  expect(dayCells(path, actual, move)).toEqual(expected.cells);
  expect(coverage(interval, actual)).toBe(expected.coverage);
  expect(
    Math.abs(winkler(interval, actual, INTERVAL_ALPHA) - expected.winkler),
  ).toBeLessThanOrEqual(NUMERIC_TOLERANCE * Math.max(1, Math.abs(expected.winkler)));
  expect(
    Math.abs(quantileLoss(path, interval, actual) - expected.quantileLoss),
  ).toBeLessThanOrEqual(NUMERIC_TOLERANCE * Math.max(1, Math.abs(expected.quantileLoss)));
});
