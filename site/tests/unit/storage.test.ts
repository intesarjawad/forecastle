import { expect, test } from "vitest";
import {
  createLiveEntryStore,
  createPlayStore,
  dailyHistory,
  type LiveEntryRecord,
  type Play,
  parseLiveEntry,
  parsePlay,
} from "../../src/io/storage";

const KEY = "forecastle.v1.plays";
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

function memory(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

test("a saved play comes back unchanged and is stored under the versioned key", () => {
  const storage = memory();
  const store = createPlayStore(() => storage);
  expect(store.read()).toEqual({ plays: [], blocked: false });
  expect(store.save(play)).toBe(true);
  expect(store.read()).toEqual({ plays: [play], blocked: false });
  expect(JSON.parse(storage.items.get(KEY) ?? "null")).toEqual([{ ...play, schemaVersion: 1 }]);
});

test("the first play of a puzzle stands", () => {
  const storage = memory();
  const store = createPlayStore(() => storage);
  store.save(play);
  expect(store.save({ ...play, closeness: 10 })).toBe(true);
  expect(store.read().plays).toEqual([play]);
});

test("stats from the crowd round-trip through the guard", () => {
  const stats = {
    count: 120,
    median: [1, 2, 3, 4, 5, 6, 7],
    p10: [0, 1, 2, 3, 4, 5, 6],
    p90: [2, 3, 4, 5, 6, 7, 8],
    quartiles: [40, 55, 70],
  };
  const storage = memory();
  const store = createPlayStore(() => storage);
  store.save({ ...play, stats });
  expect(store.read().plays[0]?.stats).toEqual(stats);
});

test("late crowd stats update the saved play without changing its result", () => {
  const stats = {
    count: 12,
    median: [1, 2, 3, 4, 5, 6, 7],
    p10: [0, 0, 0, 0, 0, 0, 0],
    p90: [8, 8, 8, 8, 8, 8, 8],
    quartiles: [25, 50, 75],
  };
  const storage = memory();
  const store = createPlayStore(() => storage);
  store.save(play);
  expect(store.saveStats(play.puzzleId, stats)).toBe(true);
  expect(store.read().plays).toEqual([{ ...play, stats }]);
  expect(store.saveStats("2026-11-19", stats)).toBe(false);
});

test.each([
  ["text that is not JSON", "{oops"],
  ["JSON that is not a list", '{"puzzleId":"2026-11-20"}'],
  ["a list of non-records", "[1, null, []]"],
])("%s reads as empty without throwing", (_name, raw) => {
  const store = createPlayStore(() => memory({ [KEY]: raw }));
  expect(store.read()).toEqual({ plays: [], blocked: false });
});

test("a damaged record is dropped and its neighbours survive", () => {
  const good = { ...play, schemaVersion: 1 };
  const raw = JSON.stringify([{ ...good, puzzleId: "2026-11-19" }, { ...good, coverage: 9 }, good]);
  const store = createPlayStore(() => memory({ [KEY]: raw }));
  expect(store.read().plays.map((saved) => saved.puzzleId)).toEqual(["2026-11-19", "2026-11-20"]);
});

test("refused access reads as empty, reports blocked and saves nothing", () => {
  const refuse = () => {
    throw new DOMException("denied", "SecurityError");
  };
  const store = createPlayStore(refuse);
  expect(store.read()).toEqual({ plays: [], blocked: true });
  expect(store.save(play)).toBe(false);
  const full = createPlayStore(() => ({ getItem: () => null, setItem: refuse }));
  expect(full.read().blocked).toBe(false);
  expect(full.save(play)).toBe(false);
});

const stored = { ...play, schemaVersion: 1 };

test("the guard accepts a current record", () => {
  expect(parsePlay(stored)).toEqual(play);
});

test.each([
  ["a null", null],
  ["an array", []],
  ["a missing version", { ...stored, schemaVersion: undefined }],
  ["a newer version", { ...stored, schemaVersion: 2 }],
  ["an empty puzzle id", { ...stored, puzzleId: "" }],
  ["an unknown kind", { ...stored, kind: "weekly" }],
  ["an unparseable date", { ...stored, playedOn: "2026-99-99" }],
  ["an impossible date", { ...stored, playedOn: "2026-02-30" }],
  ["a short path", { ...stored, path: [1, 2, 3] }],
  ["a non-finite path value", { ...stored, path: [1, 2, 3, 4, 5, 6, null] }],
  ["a zero half-width", { ...stored, halfWidth: 0 }],
  ["a closeness above 100", { ...stored, closeness: 101 }],
  ["a fractional AI closeness", { ...stored, aiCloseness: 55.5 }],
  ["a coverage of 8", { ...stored, coverage: 8 }],
  ["missing stats", { ...stored, stats: undefined }],
  ["malformed stats", { ...stored, stats: { count: 1 } }],
])("the guard rejects %s", (_name, value) => {
  expect(parsePlay(value)).toBeNull();
});

test("daily history counts each daily play once, in play order, and skips archive plays", () => {
  const plays = [
    play,
    { ...play, puzzleId: "2026-11-21", playedOn: "2026-11-21", coverage: 5 },
    { ...play, puzzleId: "2026-11-01", playedOn: "2026-11-22", coverage: 2 },
  ];
  expect(dailyHistory(plays)).toEqual({
    playedOn: ["2026-11-20", "2026-11-21"],
    coverages: [7, 5],
  });
});

const LIVE_KEY = "forecastle.v1.live";
const entry: LiveEntryRecord = {
  puzzleId: "live-2026-11-09-1",
  path: [28, 29, 30, 31, 32, 33, 34],
  halfWidth: 2,
  msToLock: 4200,
  status: "unsent",
};

test("a live entry comes back unchanged under its own versioned key", () => {
  const storage = memory();
  const store = createLiveEntryStore(() => storage);
  expect(store.save(entry)).toBe(true);
  expect(JSON.parse(storage.items.get(LIVE_KEY) ?? "")).toEqual([{ ...entry, schemaVersion: 1 }]);
  expect(store.find(entry.puzzleId)).toEqual(entry);
  expect(store.find("live-2026-11-09-2")).toBeUndefined();
  expect(storage.items.has(KEY)).toBe(false);
});

test("the first live entry for a chart stands and only its status moves", () => {
  const storage = memory();
  const store = createLiveEntryStore(() => storage);
  store.save(entry);
  store.save({ ...entry, path: [0, 0, 0, 0, 0, 0, 0] });
  expect(store.setStatus(entry.puzzleId, "sent")).toBe(true);
  expect(store.find(entry.puzzleId)).toEqual({ ...entry, status: "sent" });
});

test("a damaged live entry is dropped and blocked storage reads as none", () => {
  const good = { ...entry, schemaVersion: 1 };
  const raw = JSON.stringify([
    { ...good, puzzleId: "live-2026-11-09-2", status: "lost" },
    { ...good, path: [1, 2, 3] },
    { ...good, msToLock: 3_600_001 },
    good,
  ]);
  expect(createLiveEntryStore(() => memory({ [LIVE_KEY]: raw })).find(entry.puzzleId)).toEqual(
    entry,
  );
  expect(
    createLiveEntryStore(() => memory({ [LIVE_KEY]: raw })).find("live-2026-11-09-2"),
  ).toBeUndefined();
  const refuse = () => {
    throw new DOMException("denied", "SecurityError");
  };
  const blocked = createLiveEntryStore(refuse);
  expect(blocked.find(entry.puzzleId)).toBeUndefined();
  expect(blocked.save(entry)).toBe(false);
});

test.each([
  ["a future schema", { schemaVersion: 2 }],
  ["a zero band", { halfWidth: 0 }],
  ["a fractional lock time", { msToLock: 1.5 }],
  ["an empty id", { puzzleId: "" }],
  ["a NaN day", { path: [1, 2, 3, 4, 5, 6, Number.NaN] }],
])("the live entry guard rejects %s", (_name, change) => {
  expect(parseLiveEntry({ ...entry, schemaVersion: 1, ...change })).toBeNull();
});

test("an invalid saved date drops only that record", () => {
  const good = { ...play, schemaVersion: 1 };
  const raw = JSON.stringify([{ ...good, playedOn: "2026-99-99" }, good]);
  expect(createPlayStore(() => memory({ [KEY]: raw })).read().plays).toEqual([play]);
});
