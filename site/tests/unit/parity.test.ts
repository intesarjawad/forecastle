import { expect, test } from "vitest";
import goldenCases from "../../../scoring/golden.json";
import parityCases from "../../../scoring/parity.json";
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
const RELATIVE_TOLERANCE = 1e-9;

test("parity fixture contains 500 distinct scoring cases and all shared rejection cases", () => {
  expect(parityCases.filter((scoringCase) => scoringCase.error === undefined)).toHaveLength(500);
  expect(new Set(parityCases.map(({ name }) => name)).size).toBe(parityCases.length);
  expect(parityCases.filter((scoringCase) => scoringCase.error !== undefined)).toEqual(
    goldenCases.filter((scoringCase) => scoringCase.error !== undefined),
  );
});

test.each(parityCases)("$name", (scoringCase) => {
  if (scoringCase.error !== undefined) {
    expect(() => validateScoringInput(scoringCase)).toThrow(scoringCase.error);
    return;
  }
  validateScoringInput(scoringCase);
  const { visible, path, interval, actual, k, expected } = scoringCase;
  const move = typicalMove(visible);
  expect(Math.abs(move - expected.typicalMove)).toBeLessThanOrEqual(
    RELATIVE_TOLERANCE * Math.abs(expected.typicalMove),
  );
  expect(closeness(path, actual, move, k)).toBe(expected.closeness);
  expect(dayCells(path, actual, move)).toEqual(expected.cells);
  expect(coverage(interval, actual)).toBe(expected.coverage);
  expect(
    Math.abs(winkler(interval, actual, INTERVAL_ALPHA) - expected.winkler),
  ).toBeLessThanOrEqual(RELATIVE_TOLERANCE * Math.abs(expected.winkler));
  expect(
    Math.abs(quantileLoss(path, interval, actual) - expected.quantileLoss),
  ).toBeLessThanOrEqual(RELATIVE_TOLERANCE * Math.abs(expected.quantileLoss));
});
