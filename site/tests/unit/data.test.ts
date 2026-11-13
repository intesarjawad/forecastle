import { expect, test } from "vitest";
import type { LiveEntryRecord, Play } from "../../src/io/storage";
import { historyFile, parseHistoryFile } from "../../src/ui/data";

const play: Play = {
  puzzleId: "2026-11-20",
  kind: "daily",
  playedOn: "2026-11-20",
  path: [21.6, 19.6, 17.8, 17, 17.2, 18.4, 19.6],
  halfWidth: 3.4,
  closeness: 85,
  aiCloseness: 55,
  coverage: 7,
  stats: null,
};
const entries: LiveEntryRecord[] = [
  {
    puzzleId: "live-2026-11-09-1",
    path: [28, 28, 28, 28, 28, 28, 28],
    halfWidth: 1.25,
    msToLock: 4200,
    status: "sent",
  },
  {
    puzzleId: "live-2026-11-09-2",
    path: [30, 29, 28, 27, 26, 25, 24],
    halfWidth: 2,
    msToLock: 9000,
    status: "unsent",
  },
];

test("a download holds plays and live entries and parses back to the same records", () => {
  const text = historyFile([play], entries);
  const records = JSON.parse(text);
  expect(records.map((record: { schemaVersion: number }) => record.schemaVersion)).toEqual([
    1, 1, 1,
  ]);
  expect(parseHistoryFile(records)).toEqual({ plays: [play], entries });
});

test("a file of plays alone, as written before live entries, still restores", () => {
  expect(parseHistoryFile(JSON.parse(historyFile([play])))).toEqual({
    plays: [play],
    entries: [],
  });
});

test.each([
  ["an unknown status", { status: "lost" }],
  ["a six-day path", { path: [1, 2, 3, 4, 5, 6] }],
  ["a future schema", { schemaVersion: 2 }],
])("one live entry with %s rejects the whole file", (_name, change) => {
  const records = JSON.parse(historyFile([play], entries));
  records[1] = { ...records[1], ...change };
  expect(parseHistoryFile(records)).toBeNull();
});

test("a file that is not an array is rejected", () => {
  expect(parseHistoryFile({ plays: [play] })).toBeNull();
});
