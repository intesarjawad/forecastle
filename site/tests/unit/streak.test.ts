import { expect, test } from "vitest";
import { localDateForInstant } from "../../src/core/dates";
import { calibrationStats, recordDailyPlay, streakStats } from "../../src/core/streak";

test("empty history has no streak or calibration observations", () => {
  const history = { playedOn: [], coverages: [] };
  expect(streakStats(history, "2026-11-05")).toEqual({ current: 0, best: 0 });
  expect(calibrationStats(history)).toEqual({
    puzzleCount: 0,
    coveragePercent: null,
    recentCoverages: [],
  });
});

test("consecutive calendar dates count once, regardless of input order", () => {
  const history = {
    playedOn: ["2026-11-05", "2026-11-03", "2026-11-04", "2026-11-04"],
    coverages: [],
  };
  expect(streakStats(history, "2026-11-05")).toEqual({ current: 3, best: 3 });
  expect(streakStats(history, "2026-11-06")).toEqual({ current: 3, best: 3 });
  expect(streakStats(history, "2026-11-07")).toEqual({ current: 0, best: 3 });
});

test("a gap resets the current streak and retains the best", () => {
  const history = {
    playedOn: ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-05"],
    coverages: [],
  };
  expect(streakStats(history, "2026-11-05")).toEqual({ current: 1, best: 3 });
});

test("consecutive streaks cross leap days and year boundaries", () => {
  expect(
    streakStats(
      { playedOn: ["2024-02-28", "2024-02-29", "2024-03-01"], coverages: [] },
      "2024-03-01",
    ),
  ).toEqual({ current: 3, best: 3 });
  expect(
    streakStats({ playedOn: ["2026-12-31", "2027-01-01"], coverages: [] }, "2027-01-01"),
  ).toEqual({ current: 2, best: 2 });
});

test("archive plays and replays do not add streak days or calibration observations", () => {
  const history = Object.freeze({
    playedOn: Object.freeze(["2026-11-04"]),
    coverages: Object.freeze([5]),
  });
  expect(recordDailyPlay(history, "2026-11-03", "2026-11-05", 7)).toEqual(history);
  expect(recordDailyPlay(history, "2026-11-04", "2026-11-04", 7)).toEqual(history);
  const next = recordDailyPlay(history, "2026-11-05", "2026-11-05", 6);
  expect(next).toEqual({ playedOn: ["2026-11-04", "2026-11-05"], coverages: [5, 6] });
  expect(streakStats(next, "2026-11-05")).toEqual({ current: 2, best: 2 });
  expect(calibrationStats(next).puzzleCount).toBe(2);
  expect(history.coverages).toEqual([5]);
});

test("keeps recorded local dates when a player crosses time zones", () => {
  const firstDate = localDateForInstant(Date.parse("2026-11-05T10:00:00Z"), 720);
  const nextDate = localDateForInstant(Date.parse("2026-11-05T11:00:00Z"), -840);
  const first = recordDailyPlay({ playedOn: [], coverages: [] }, firstDate, firstDate, 5);
  const next = recordDailyPlay(first, nextDate, nextDate, 6);
  expect(next.playedOn).toEqual(["2026-11-04", "2026-11-06"]);
  expect(streakStats(next, nextDate)).toEqual({ current: 1, best: 1 });
  expect(streakStats(next, "2026-11-05")).toEqual({ current: 1, best: 1 });
  expect(recordDailyPlay(next, firstDate, firstDate, 7)).toEqual(next);
});

test("westward travel preserves a lifetime best of three while current falls to two", () => {
  const history = {
    playedOn: ["2026-11-03", "2026-11-04", "2026-11-05"],
    coverages: [5, 6, 7],
  };
  expect(streakStats(history, "2026-11-05")).toEqual({ current: 3, best: 3 });
  expect(streakStats(history, "2026-11-04")).toEqual({ current: 2, best: 3 });
});

test("averages coverage counts over seven days per puzzle", () => {
  const history = { playedOn: [], coverages: [0, 3, 5, 7] };
  expect(calibrationStats(history)).toEqual({
    puzzleCount: 4,
    coveragePercent: (15 / 28) * 100,
    recentCoverages: [0, 3, 5, 7],
  });
});

test("keeps the last 14 observations for the strip and all observations for the mean", () => {
  const coverages = [0, ...Array.from({ length: 14 }, () => 7)];
  const stats = calibrationStats({ playedOn: [], coverages });
  expect(stats.puzzleCount).toBe(15);
  expect(stats.coveragePercent).toBeCloseTo((14 / 15) * 100);
  expect(stats.recentCoverages).toEqual(Array.from({ length: 14 }, () => 7));
  expect(coverages).toHaveLength(15);
});
