import { expect, test, vi } from "vitest";
import {
  archiveEntries,
  loadArchivePuzzle,
  otherLiveRounds,
  parseRoute,
} from "../../src/ui/archive";

function index(ids: string[]) {
  return {
    launchDate: "2026-11-20",
    puzzles: ids.map((id, offset) => ({
      id,
      number: offset + 1,
      kind: "historical" as const,
      label: `Puzzle ${offset + 1}`,
    })),
    live: [],
  };
}

function dailyPuzzle(id: string) {
  return {
    id,
    number: 2,
    kind: "historical",
    seriesId: "meteo-oslo-tmean",
    label: "Daily mean temperature, Oslo",
    unit: "°C",
    visible: Array(28).fill(5),
    typicalMove: 1,
    yDomain: [0, 10],
    horizon: 7,
    gapDays: 0,
    ai: {
      forecaster: "amazon/chronos-2",
      revision: "29ec37",
      median: Array(7).fill(5),
      q10: Array(7).fill(4),
      q90: Array(7).fill(6),
    },
    forecastSha256: "a".repeat(64),
  };
}

test("the hash routes name every page and nothing else", () => {
  expect(parseRoute("")).toEqual({ kind: "today" });
  expect(parseRoute("#")).toEqual({ kind: "today" });
  expect(parseRoute("#/")).toEqual({ kind: "today" });
  expect(parseRoute("#/archive")).toEqual({ kind: "archive" });
  expect(parseRoute("#/live")).toEqual({ kind: "live" });
  expect(parseRoute("#/how")).toEqual({ kind: "how" });
  expect(parseRoute("#/p/2026-11-22")).toEqual({ kind: "puzzle", id: "2026-11-22" });
  expect(parseRoute("#/live/live-2026-11-09")).toEqual({ kind: "live", id: "live-2026-11-09" });
});

test("other live rounds stay reachable, newest first, with resolved ones marked", () => {
  const round = (id: string, resolved: boolean) => ({
    id,
    charts: 3,
    opensUtc: `${id.slice(5)}T00:05:00Z`,
    cutoffUtc: "2026-12-31T23:59:59Z",
    resolvesUtc: "2027-01-09T06:00:00Z",
    resolved,
  });
  const withRounds = {
    ...index([]),
    live: [
      round("live-2026-10-26", true),
      round("live-2026-11-09", false),
      round("live-2026-10-29", true),
    ],
  };
  expect(otherLiveRounds(withRounds, "live-2026-11-09")).toEqual([
    {
      id: "live-2026-10-29",
      href: "#/live/live-2026-10-29",
      text: "Round opened 2026-10-29: results",
    },
    {
      id: "live-2026-10-26",
      href: "#/live/live-2026-10-26",
      text: "Round opened 2026-10-26: results",
    },
  ]);
  expect(
    otherLiveRounds({ ...withRounds, live: [round("live-2026-11-09", false)] }, "live-2026-11-09"),
  ).toEqual([]);
});

test.each([
  ["a missing date", "#/p/"],
  ["a malformed date", "#/p/2026-02-30"],
  ["a date with a time", "#/p/2026-11-22T00:00"],
  ["an unknown page", "#/scores"],
  ["a trailing slash", "#/archive/"],
  ["a live round without a date", "#/live/live-"],
  ["a live round with a malformed date", "#/live/live-2026-02-30"],
  ["a live path that is not a round", "#/live/2026-11-09"],
])("rejects %s", (_name, hash) => {
  expect(parseRoute(hash)).toEqual({ kind: "unknown" });
});

test("the archive lists the newest puzzle first with a link to each day", () => {
  expect(archiveEntries(index(["2026-11-20", "2026-11-22", "2026-11-21"]))).toEqual([
    { id: "2026-11-22", href: "#/p/2026-11-22", text: "#2: Puzzle 2, 2026-11-22" },
    { id: "2026-11-21", href: "#/p/2026-11-21", text: "#3: Puzzle 3, 2026-11-21" },
    { id: "2026-11-20", href: "#/p/2026-11-20", text: "#1: Puzzle 1, 2026-11-20" },
  ]);
});

test("an archived puzzle is read from the published day and checked against its URL", async () => {
  const id = "2026-11-22";
  const transport = vi.fn(async () => Response.json(dailyPuzzle(id)));
  expect(await loadArchivePuzzle(id, transport, "/base/")).toEqual(dailyPuzzle(id));
  expect(transport).toHaveBeenCalledWith("/base/puzzles/2026-11-22/puzzle.json");
});

test("a mismatched or missing archive file is rejected", async () => {
  await expect(
    loadArchivePuzzle("2026-11-22", async () => Response.json(dailyPuzzle("2026-11-21"))),
  ).rejects.toThrow();
  await expect(
    loadArchivePuzzle("2026-11-22", async () => new Response("missing", { status: 404 })),
  ).rejects.toThrow();
});

test.each(["2026-99-99", "2026-00-10", "2026-02-30"])(
  "invalid daily and live route dates %s stay explicit",
  (day) => {
    expect(parseRoute(`#/p/${day}`)).toEqual({ kind: "unknown" });
    expect(parseRoute(`#/live/live-${day}`)).toEqual({ kind: "unknown" });
  },
);
