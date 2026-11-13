import { expect, test } from "vitest";
import { reason, verdict } from "../../src/core/verdict";

// With move=2 and k=5, MAE 2 gives 80 and MAE 5 gives 50.
// Coverage is a count: its order matters only when the rounded scores tie.
test.each([
  [{ closeness: 80, coverage: 2 }, { closeness: 50, coverage: 7 }, "You beat the AI by 30 points"],
  [{ closeness: 50, coverage: 7 }, { closeness: 80, coverage: 2 }, "The AI beat you by 30 points"],
  [{ closeness: 81, coverage: 2 }, { closeness: 80, coverage: 7 }, "You beat the AI by 1 point"],
  [{ closeness: 80, coverage: 6 }, { closeness: 80, coverage: 5 }, "You beat the AI on the band"],
  [{ closeness: 80, coverage: 5 }, { closeness: 80, coverage: 6 }, "The AI beat you on the band"],
  [{ closeness: 80, coverage: 6 }, { closeness: 80, coverage: 6 }, "Draw"],
])("compares %j with %j", (you, ai, expected) => {
  expect(verdict(you, ai)).toBe(expected);
});

// The band that caught more days must not read as the winner when Closeness decided.
test.each([
  [
    { closeness: 56, coverage: 6 },
    { closeness: 55, coverage: 7 },
    "Closer overall, 56 to 55 (100 is exact)",
  ],
  [
    { closeness: 55, coverage: 7 },
    { closeness: 56, coverage: 6 },
    "Closer overall, 56 to 55 (100 is exact)",
  ],
  [
    { closeness: 80, coverage: 6 },
    { closeness: 80, coverage: 5 },
    "Level at 80; your band caught 6 of 7 days, the AI's 5",
  ],
  [
    { closeness: 80, coverage: 6 },
    { closeness: 80, coverage: 6 },
    "Level at 80, and both bands caught 6 of 7 days",
  ],
])("explains %j against %j", (you, ai, expected) => {
  expect(reason(you, ai)).toBe(expected);
});
