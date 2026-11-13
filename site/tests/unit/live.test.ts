import { expect, test } from "vitest";
import type { CrowdResult } from "../../src/io/submissions";
import {
  entryOutcome,
  futureSlotX,
  hashPrefix,
  type LiveGeometry,
  liveBadge,
  liveGapBox,
  livePath,
  liveState,
  liveTableRows,
  parseLiveAnswer,
  parseLiveForecast,
  parseLivePuzzle,
} from "../../src/ui/live";
import { messages } from "../../src/ui/messages";

const ID = "live-2026-11-09-1";
const SCORED_DATES = [
  "2026-11-11",
  "2026-11-12",
  "2026-11-13",
  "2026-11-14",
  "2026-11-15",
  "2026-11-16",
  "2026-11-17",
];

function puzzle() {
  return {
    id: ID,
    number: 1,
    kind: "prospective",
    seriesId: "fixture-series-1",
    label: "Synthetic series",
    unit: "count",
    visible: Array.from({ length: 28 }, (_, day) => day),
    typicalMove: 1,
    yDomain: [-10.8, 37.8],
    horizon: 7,
    gapDays: 3,
    forecastSha256: "b".repeat(64),
    opensUtc: "2026-11-09T00:05:00+00:00",
    cutoffUtc: "2026-11-10T23:59:59+00:00",
    resolvesUtc: "2026-11-18T06:00:00+00:00",
    scoredDates: SCORED_DATES,
  };
}

function forecast() {
  return {
    forecaster: "fixture",
    revision: "0".repeat(40),
    median: Array(7).fill(30),
    q10: Array(7).fill(20),
    q90: Array(7).fill(40),
    comparisons: {
      flat: { median: Array(7).fill(30), q10: Array(7).fill(20), q90: Array(7).fill(40) },
    },
  };
}

function answer() {
  return {
    id: ID,
    dates: SCORED_DATES,
    actual: [28, 29, 30, 31, 32, 33, 34],
    source: { name: "Wikimedia Pageviews", license: "CC0-1.0" },
    crowd: {
      count: 10,
      median: [5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5],
      p10: [1.9, 2.9, 3.9, 4.9, 5.9, 6.9, 7.9],
      p90: [9.1, 10.1, 11.1, 12.1, 13.1, 14.1, 15.1],
    },
  };
}

test("a live puzzle is accepted with its calendar window and gap", () => {
  const result = parseLivePuzzle(puzzle());
  expect(result.id).toBe(ID);
  expect(result.number).toBe(1);
  expect(result.gapDays).toBe(3);
  expect(result.visible).toEqual(Array.from({ length: 28 }, (_, day) => day));
  expect(result.scoredDates).toEqual(SCORED_DATES);
  expect(result.yDomain).toEqual([-10.8, 37.8]);
  expect(parseLivePuzzle({ ...puzzle(), cutoffForecastSha256: "c".repeat(64) }).number).toBe(1);
});

test.each([
  ["a missing key", { ...puzzle(), gapDays: undefined }],
  ["an extra key", { ...puzzle(), answer: [] }],
  ["the wrong kind", { ...puzzle(), kind: "historical" }],
  ["a zero chart number", { ...puzzle(), number: 0 }],
  ["a six-day horizon", { ...puzzle(), horizon: 6 }],
  ["a negative gap", { ...puzzle(), gapDays: -1 }],
  ["an inverted domain", { ...puzzle(), yDomain: [10, 0] }],
  ["a short forecast digest", { ...puzzle(), forecastSha256: "abc" }],
  ["a closed window", { ...puzzle(), cutoffUtc: "2026-11-08T00:00:00+00:00" }],
  ["six scored dates", { ...puzzle(), scoredDates: SCORED_DATES.slice(0, 6) }],
  [
    "non-consecutive scored dates",
    { ...puzzle(), scoredDates: [...SCORED_DATES.slice(0, 6), "2026-11-19"] },
  ],
  ["27 visible values", { ...puzzle(), visible: Array(27).fill(1) }],
])("rejects %s", (_name, value) => {
  expect(() => parseLivePuzzle(value)).toThrow();
});

test("a live forecast keeps the quantiles and ignores comparison rows", () => {
  expect(parseLiveForecast(forecast())).toEqual({
    forecaster: "fixture",
    revision: "0".repeat(40),
    median: Array(7).fill(30),
    q10: Array(7).fill(20),
    q90: Array(7).fill(40),
  });
  expect(() => parseLiveForecast({ ...forecast(), median: Array(7).fill(15) })).toThrow();
});

test("a live answer exposes the crowd and drops the source metadata", () => {
  expect(parseLiveAnswer(answer(), ID)).toEqual({
    dates: SCORED_DATES,
    actual: [28, 29, 30, 31, 32, 33, 34],
    crowd: answer().crowd,
  });
  const dailyDates = [
    ...Array.from({ length: 28 }, (_, day) =>
      new Date(Date.UTC(2026, 9, 14 + day)).toISOString().slice(0, 10),
    ),
    ...SCORED_DATES,
  ];
  expect(parseLiveAnswer({ ...answer(), dates: dailyDates }, ID).dates).toEqual(SCORED_DATES);
});

test.each([
  ["a mismatched id", { ...answer(), id: "live-2026-11-09-2" }],
  ["six actual values", { ...answer(), actual: [28, 29, 30, 31, 32, 33] }],
  ["a crossing crowd", { ...answer(), crowd: { ...answer().crowd, p10: Array(7).fill(12) } }],
  ["an eight-day crowd", { ...answer(), crowd: { ...answer().crowd, median: Array(8).fill(5) } }],
])("rejects %s", (_name, value) => {
  expect(() => parseLiveAnswer(value, ID)).toThrow();
});

test("the clock separates a sealed round from one waiting for its record", () => {
  const entry = {
    id: "live-2026-11-09",
    charts: 3,
    opensUtc: "2026-11-09T00:05:00+00:00",
    cutoffUtc: "2026-11-10T23:59:59+00:00",
    resolvesUtc: "2026-11-18T06:00:00+00:00",
    resolved: false,
  };
  expect(liveState(entry, Date.parse("2026-11-10T23:59:58+00:00"))).toBe("pending");
  expect(liveState(entry, Date.parse("2026-11-10T23:59:59+00:00"))).toBe("awaiting");
  expect(liveState({ ...entry, resolved: true }, Date.parse("2026-11-09T00:05:00+00:00"))).toBe(
    "resolved",
  );
});

test("the badge shows both instants in the requested locale and zone", () => {
  const entry = {
    id: "live-2026-11-09",
    charts: 3,
    opensUtc: "2026-11-09T00:05:00+00:00",
    cutoffUtc: "2026-11-10T23:59:59+00:00",
    resolvesUtc: "2026-11-18T06:00:00+00:00",
    resolved: false,
  };
  expect(liveBadge(entry, "en-GB", "UTC")).toBe(
    "Closes 10 Nov 2026, 23:59. Resolves 18 Nov 2026, 06:00.",
  );
});

test("the hash prefix is the first twelve characters", () => {
  expect(hashPrefix("0123456789abcdef")).toBe("0123456789ab");
});

test("future slots leave room for the gap before the seven scored days", () => {
  const geometry = { today: 100, right: 200 };
  expect(futureSlotX(geometry, 0, 10)).toBe(110);
  expect(futureSlotX(geometry, 9, 10)).toBe(200);
  expect(() => futureSlotX(geometry, 0, 0)).toThrow();
});

test("a forecast path starts at the history edge and skips the gap slots", () => {
  const geometry: LiveGeometry = {
    today: 100,
    right: 200,
    top: 10,
    bottom: 110,
    y: (value) => value,
  };
  expect(livePath([1, 2], geometry, 3, 0)).toBe("M100,0L180,1L200,2");
  expect(livePath([1], geometry, 0, 0)).toBe("M100,0L200,1");
});

test("the hatched box covers only the gap columns", () => {
  const geometry: LiveGeometry = {
    today: 100,
    right: 200,
    top: 10,
    bottom: 110,
    y: (value) => value,
  };
  expect(liveGapBox(geometry, 3, 7)).toEqual({ x: 100, y: 10, width: 30, height: 100 });
  expect(liveGapBox(geometry, 0, 7)).toBeNull();
});

test("the accessible rows align each line with its scored date", () => {
  expect(liveTableRows(puzzle(), forecast(), answer())[0]).toEqual({
    date: "2026-11-11",
    ai: 30,
    crowd: 5.5,
    actual: 28,
  });
  expect(liveTableRows(puzzle())[6]).toEqual({ date: "2026-11-17" });
});

test("an entry is offered until the last millisecond before the cutoff", () => {
  const entry = {
    id: "live-2026-11-09",
    charts: 3,
    opensUtc: "2026-11-09T00:05:00+00:00",
    cutoffUtc: "2026-11-10T23:59:59+00:00",
    resolvesUtc: "2026-11-18T06:00:00+00:00",
    resolved: false,
  };
  const cutoff = Date.parse(entry.cutoffUtc);
  expect(liveState(entry, Date.parse(entry.opensUtc))).toBe("pending");
  expect(liveState(entry, cutoff - 1)).toBe("pending");
  expect(liveState(entry, cutoff)).toBe("awaiting");
  expect(liveState(entry, cutoff + 1)).toBe("awaiting");
});

test.each([
  [{ kind: "entered" }, true, { status: "sent", note: "entered" }],
  [{ kind: "duplicate" }, true, { status: "sent", note: "duplicate" }],
  [{ kind: "kept" }, true, { status: "kept", note: "kept" }],
  [{ kind: "skipped" }, true, { status: "unserved", note: "unserved" }],
  [{ kind: "closed" }, true, { status: "unsent", note: "closed" }],
  [{ kind: "busy" }, false, { status: "unsent", note: "busy" }],
  [{ kind: "unavailable" }, false, { status: "unsent", note: "offline" }],
  [{ kind: "unavailable" }, true, { status: "unsent", note: "busy" }],
  [{ kind: "pending" }, true, null],
  [{ kind: "hidden" }, true, null],
] as const)(
  "a send outcome of %o (online %s) is stored and told as %o",
  (result, online, expected) => {
    expect(entryOutcome(result as CrowdResult, online)).toEqual(expected);
  },
);

test("every live entry message says what happened, and errors name their one step", () => {
  const run = () => {};
  const notices = [
    messages.live.entered("Nov 9, 2026, 12:05 AM", "Nov 18, 2026, 6:00 AM"),
    messages.live.duplicate("Nov 18, 2026, 6:00 AM"),
    messages.live.kept,
    messages.live.unserved,
    messages.live.awaitingEntry("Nov 18, 2026, 6:00 AM"),
    messages.live.notCounted,
  ];
  const errors = [
    [
      messages.live.closed("Nov 10, 2026, 11:59 PM", "Nov 18, 2026, 6:00 AM", run),
      "Play today's puzzle",
    ],
    [messages.live.offline(run), "Send again"],
    [messages.live.busy(run), "Send again"],
  ] as const;
  for (const notice of notices) {
    expect(notice.kind).toBe("notice");
    expect(notice.what.endsWith(".")).toBe(true);
  }
  for (const [error, label] of errors) {
    expect(error.kind).toBe("error");
    expect(error.what.endsWith(".")).toBe(true);
    expect(error.action.label).toBe(label);
    expect(error.action.run).toBe(run);
  }
  expect(errors[0][0].what).toBe(
    "Entries for this round closed at Nov 10, 2026, 11:59 PM. It resolves Nov 18, 2026, 6:00 AM.",
  );
});
