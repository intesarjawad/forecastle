import { expect, test } from "vitest";
import { calibrationLine, countdownText, recordLines } from "../../src/ui/share-panel";

test("the countdown reads hours and zero-padded minutes, rounding up", () => {
  expect(countdownText((13 * 60 + 2) * 60_000)).toBe("Next puzzle in 13 h 02 m");
  expect(countdownText((13 * 60 + 1) * 60_000 + 1)).toBe("Next puzzle in 13 h 02 m");
  expect(countdownText(30_000)).toBe("Next puzzle in 0 h 01 m");
  expect(countdownText(0)).toBe("Next puzzle in 0 h 00 m");
});

test("one daily play gives a one-day streak and a full calibration record", () => {
  const history = { playedOn: ["2026-11-20"], coverages: [7] };
  expect(recordLines(history, "2026-11-20")).toEqual(["Streak 1 day, best 1."]);
  expect(calibrationLine(history)).toBe(
    "Your band has caught 100% of real days over 1 puzzle; aim for 80%.",
  );
});

test("a run, a gap and a rounded percentage", () => {
  const history = {
    playedOn: ["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-22"],
    coverages: [5, 4, 6, 7],
  };
  expect(recordLines(history, "2026-11-22")).toEqual(["Streak 1 day, best 3."]);
  expect(calibrationLine(history)).toBe(
    "Your band has caught 79% of real days over 4 puzzles; aim for 80%.",
  );
});

test("with no daily play there is a streak line and no calibration line", () => {
  expect(recordLines({ playedOn: [], coverages: [] }, "2026-11-20")).toEqual([
    "Streak 0 days, best 0.",
  ]);
  expect(calibrationLine({ playedOn: [], coverages: [] })).toBeNull();
});

test("an archive play says it does not join the streak instead of reading as a loss", () => {
  const history = { playedOn: ["2026-11-20"], coverages: [7] };
  expect(recordLines(history, "2026-11-20", "2026-11-20")[0]).toBe("Streak 1 day, best 1.");
  expect(recordLines(history, "2026-11-20", "2026-10-21")[0]).toBe(
    "An archive puzzle, so your streak stays at 1 day, best 1.",
  );
});
