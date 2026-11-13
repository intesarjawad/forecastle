import { expect, test } from "vitest";
import { mergeHistory, parseHistory, parseStats } from "../../src/core/history";

function stats() {
  return {
    count: 12,
    median: [1, 2, 3, 4, 5, 6, 7],
    p10: Array(7).fill(0),
    p90: Array(7).fill(8),
    quartiles: [25, 50, 75],
  };
}

test("accepts and copies the crowd response shape", () => {
  const input = stats();
  const result = parseStats(input);
  expect(result).toEqual(input);
  input.median[0] = 99;
  expect(result?.median[0]).toBe(1);
  expect(parseStats({ ...stats(), count: 0, quartiles: [0, 0, 100] })).not.toBeNull();
});

test.each([
  null,
  [],
  "stats",
  {},
  ...["count", "median", "p10", "p90", "quartiles"].map((field) => ({
    ...stats(),
    [field]: undefined,
  })),
  ...[-1, 1.5, Number.NaN, Infinity, "1"].map((count) => ({ ...stats(), count })),
  ...["median", "p10", "p90"].flatMap((field) => [
    { ...stats(), [field]: Array(6).fill(0) },
    { ...stats(), [field]: Array(8).fill(0) },
    { ...stats(), [field]: [0, 0, 0, 0, 0, 0, Infinity] },
    { ...stats(), [field]: [0, 0, 0, 0, 0, 0, Number.NaN] },
    { ...stats(), [field]: [0, 0, 0, 0, 0, 0, "0"] },
    { ...stats(), [field]: new Array(7) },
  ]),
  ...[
    [0, 50],
    [-1, 50, 75],
    [25, 50, 101],
    [50, 25, 75],
    [0, 75, 50],
    [0, Number.NaN, 100],
  ].map((quartiles) => ({ ...stats(), quartiles })),
])("rejects malformed crowd statistics %#", (input) => {
  expect(parseStats(input)).toBeNull();
});

function saved(puzzleId: string, closeness: number) {
  return {
    puzzleId,
    kind: "daily" as const,
    playedOn: puzzleId,
    path: [1, 2, 3, 4, 5, 6, 7],
    halfWidth: 1.5,
    closeness,
    aiCloseness: 60,
    coverage: 5,
    stats: null,
  };
}

const validStats = {
  count: 12,
  median: [1, 2, 3, 4, 5, 6, 7],
  p10: Array(7).fill(0),
  p90: Array(7).fill(8),
  quartiles: [25, 50, 75],
};

test("a restore file keeps a valid play and its crowd line", () => {
  const record = { ...saved("2026-11-20", 80), schemaVersion: 1, stats: validStats };
  expect(parseHistory([record])).toEqual([
    {
      puzzleId: "2026-11-20",
      kind: "daily",
      playedOn: "2026-11-20",
      path: [1, 2, 3, 4, 5, 6, 7],
      halfWidth: 1.5,
      closeness: 80,
      aiCloseness: 60,
      coverage: 5,
      stats: validStats,
    },
  ]);
});

test.each([
  ["a NaN median", { ...validStats, median: [Number.NaN, 2, 3, 4, 5, 6, 7] }],
  ["a six-value p10", { ...validStats, p10: [0, 0, 0, 0, 0, 0] }],
  ["no statistics at all", undefined],
])("a play with %s is restored without a crowd line", (_name, stats) => {
  const record: Record<string, unknown> = { ...saved("2026-11-20", 80), schemaVersion: 1 };
  if (stats !== undefined) record.stats = stats;
  expect(parseHistory([record])?.[0]?.stats).toBeNull();
});

test.each([
  ["a body that is not a list", {}],
  ["an unknown schema version", [{ ...saved("2026-11-20", 80), schemaVersion: 2 }]],
  ["a record without a version", [saved("2026-11-20", 80)]],
])("a restore file with %s is rejected", (_name, value) => {
  expect(parseHistory(value)).toBeNull();
});

test("a restore keeps the play already on this device and adds the missing ones", () => {
  const local = [saved("2026-11-20", 70)];
  const restored = [
    { ...saved("2026-11-20", 95), schemaVersion: 1 },
    { ...saved("2026-11-21", 90), schemaVersion: 1 },
    { ...saved("2026-11-21", 10), schemaVersion: 1 },
  ];
  const merged = mergeHistory(local, parseHistory(restored) ?? []);
  expect(merged.map((play) => [play.puzzleId, play.closeness])).toEqual([
    ["2026-11-20", 70],
    ["2026-11-21", 90],
  ]);
});

test.each(["2026-99-99", "2026-00-10", "2026-02-30", "not-a-date"])(
  "restore rejects invalid calendar date %s without throwing",
  (playedOn) => {
    expect(parseHistory([{ ...saved("2026-11-20", 80), schemaVersion: 1, playedOn }])).toBeNull();
  },
);
