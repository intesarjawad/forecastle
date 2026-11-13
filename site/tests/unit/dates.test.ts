import { expect, test } from "vitest";
import {
  localDateForInstant,
  msToLocalMidnight,
  puzzleIdForLocalDate,
  puzzleNumber,
} from "../../src/core/dates";

test("numbers puzzles from launch and has no puzzle before launch", () => {
  expect(puzzleIdForLocalDate("2026-11-05", "2026-11-04")).toBeNull();
  expect(puzzleNumber("2026-11-05", "2026-11-04")).toBeNull();
  expect(puzzleIdForLocalDate("2026-11-05", "2026-11-05")).toBe("2026-11-05");
  expect(puzzleNumber("2026-11-05", "2026-11-05")).toBe(1);
  expect(puzzleNumber("2026-11-05", "2026-11-06")).toBe(2);
});

test.each([
  ["2024-02-28", "2024-03-01", 3],
  ["2025-02-28", "2025-03-01", 2],
  ["2026-12-31", "2027-01-01", 2],
  ["2026-03-07", "2026-03-09", 3],
  ["2026-10-31", "2026-11-02", 3],
])("counts calendar days from %s to %s", (launch, localDate, expected) => {
  expect(puzzleNumber(launch, localDate)).toBe(expected);
});

test.each([
  { offset: 720, date: "2026-11-04", number: null, hours: 11 },
  { offset: 0, date: "2026-11-05", number: 1, hours: 23 },
  { offset: -840, date: "2026-11-05", number: 1, hours: 9 },
])("maps one instant at offset $offset", ({ offset, date, number, hours }) => {
  const nowMs = Date.parse("2026-11-05T01:00:00Z");
  const localDate = localDateForInstant(nowMs, offset);
  expect(localDate).toBe(date);
  expect(puzzleIdForLocalDate("2026-11-05", localDate)).toBe(number === null ? null : date);
  expect(puzzleNumber("2026-11-05", localDate)).toBe(number);
  const nextMidnightMs = Date.parse(date) + 86_400_000 + offset * 60_000;
  expect(msToLocalMidnight(nowMs, nextMidnightMs)).toBe(hours * 60 * 60 * 1_000);
});

test("UTC+14 can reach the next puzzle while UTC-12 is on the previous day", () => {
  const nowMs = Date.parse("2026-11-05T11:00:00Z");
  expect(localDateForInstant(nowMs, 720)).toBe("2026-11-04");
  expect(localDateForInstant(nowMs, -840)).toBe("2026-11-06");
  expect(puzzleNumber("2026-11-04", localDateForInstant(nowMs, 720))).toBe(1);
  expect(puzzleNumber("2026-11-04", localDateForInstant(nowMs, -840))).toBe(3);
});

test("counts down to the next midnight, including fractional time and pre-epoch dates", () => {
  const nextMidnight = Date.parse("2026-11-06T00:00:00Z");
  expect(msToLocalMidnight(Date.parse("2026-11-05T00:00:00Z"), nextMidnight)).toBe(86_400_000);
  expect(msToLocalMidnight(Date.parse("2026-11-05T23:59:59.999Z"), nextMidnight)).toBe(1);
  expect(msToLocalMidnight(-1, 0)).toBe(1);
  expect(
    msToLocalMidnight(
      Date.parse("2026-11-05T23:59:59.999+05:30"),
      Date.parse("2026-11-06T00:00:00+05:30"),
    ),
  ).toBe(1);
});

test.each([
  ["2026-03-08T00:00:00-06:00", "2026-03-09T00:00:00-05:00", 23],
  ["2026-11-01T00:00:00-05:00", "2026-11-02T00:00:00-06:00", 25],
])("counts the America/Chicago DST day from %s", (now, nextMidnight, hours) => {
  expect(msToLocalMidnight(Date.parse(now), Date.parse(nextMidnight))).toBe(hours * 3_600_000);
});
