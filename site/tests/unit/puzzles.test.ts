import { describe, expect, test, vi } from "vitest";
import game from "../../../data/game.json";
import { parseForecast, parsePuzzle, parsePuzzleIndex } from "../../src/io/puzzle-validation";
import { createInitialTransport, createPuzzleLoader } from "../../src/io/puzzles";

function day(offset: number) {
  return new Date(Date.parse(game.launchDate) + offset * 86_400_000).toISOString().slice(0, 10);
}

function puzzle(id = day(2)) {
  return {
    id,
    number: 3,
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

function index(ids = [day(1), day(3), day(0)]) {
  return {
    launchDate: day(0),
    puzzles: ids.map((id, offset) => ({
      id,
      number: offset + 1,
      kind: "historical",
      label: "Temperature",
    })),
    live: [
      {
        id: `live-${day(3)}`,
        charts: 3,
        opensUtc: `${day(3)}T00:00:00Z`,
        cutoffUtc: `${day(5)}T00:00:00Z`,
        resolvesUtc: `${day(5)}T06:00:00Z`,
        resolved: false,
      },
    ],
  };
}

const NOW = Date.parse(`${day(3)}T02:00:00Z`);
const OFFSET_MIN = 360;
const TODAY_URL = `/puzzles/${day(2)}/puzzle.json`;
const INDEX_URL = "/puzzles/index.json";

function transport(body: unknown = puzzle(), status = 200) {
  return vi.fn(async (_url: string) => Response.json(body, { status }));
}

describe("daily puzzle validation", () => {
  test("accepts the complete daily shape", () => {
    expect(parsePuzzle(puzzle())).toEqual(puzzle());
  });

  test.each(Object.keys(puzzle()))("rejects missing %s", (field) => {
    const input: Record<string, unknown> = { ...puzzle() };
    delete input[field];
    expect(() => parsePuzzle(input)).toThrow();
  });

  test.each([
    null,
    [],
    "puzzle",
    { ...puzzle(), actual: Array(7).fill(5) },
    { ...puzzle(), dates: [] },
    { ...puzzle(), kind: "prospective" },
    { ...puzzle(), id: "2026-02-30" },
    { ...puzzle(), number: 0 },
    { ...puzzle(), number: 1.5 },
    { ...puzzle(), number: Number.NaN },
    { ...puzzle(), seriesId: "" },
    { ...puzzle(), label: "" },
    { ...puzzle(), label: "x".repeat(81) },
    { ...puzzle(), unit: "x".repeat(17) },
    { ...puzzle(), horizon: 6 },
    { ...puzzle(), gapDays: 3 },
    { ...puzzle(), typicalMove: 0 },
    { ...puzzle(), typicalMove: Number.NaN },
    { ...puzzle(), typicalMove: Number.POSITIVE_INFINITY },
    { ...puzzle(), yDomain: [10, 0] },
    { ...puzzle(), yDomain: [1, 1] },
    { ...puzzle(), yDomain: [0, Number.NaN] },
    { ...puzzle(), yDomain: [0] },
    { ...puzzle(), forecastSha256: "not-a-hash" },
    { ...puzzle(), visible: Array(27).fill(5) },
    { ...puzzle(), visible: Array(29).fill(5) },
    { ...puzzle(), visible: [...Array(27).fill(5), Number.NaN] },
    { ...puzzle(), visible: [...Array(27).fill(5), "5"] },
    { ...puzzle(), visible: [...Array(27).fill(5), 1e101] },
  ])("rejects malformed input %#", (input) => {
    expect(() => parsePuzzle(input)).toThrow();
  });

  test.each(["median", "q10", "q90"])("rejects invalid forecast %s", (field) => {
    for (const values of [
      Array(6).fill(5),
      Array(8).fill(5),
      [...Array(6).fill(5), Number.NaN],
      [...Array(6).fill(5), Number.NEGATIVE_INFINITY],
    ]) {
      expect(() => parseForecast({ ...puzzle().ai, [field]: values })).toThrow();
    }
  });

  test.each(Object.keys(puzzle().ai))("rejects missing forecast %s", (field) => {
    const forecast: Record<string, unknown> = { ...puzzle().ai };
    delete forecast[field];
    expect(() => parseForecast(forecast)).toThrow();
  });

  test("rejects crossed quantiles and extra nested keys", () => {
    expect(() => parseForecast({ ...puzzle().ai, q10: Array(7).fill(6) })).toThrow();
    expect(() => parseForecast({ ...puzzle().ai, q90: Array(7).fill(4) })).toThrow();
    expect(() => parseForecast({ ...puzzle().ai, actual: [] })).toThrow();
  });
});

describe("index validation", () => {
  test("accepts UTC offsets in live metadata", () => {
    const body = index();
    body.live[0] = {
      ...body.live[0],
      id: `live-${day(3)}`,
      charts: 3,
      opensUtc: `${day(3)}T00:00:00+00:00`,
      cutoffUtc: `${day(5)}T00:00:00+00:00`,
      resolvesUtc: `${day(5)}T06:00:00+00:00`,
      resolved: false,
    };
    expect(parsePuzzleIndex(body)).toEqual(body);
  });

  test("accepts archive and live metadata", () => {
    expect(parsePuzzleIndex(index())).toEqual(index());
  });

  test.each([
    {},
    { ...index(), extra: true },
    { ...index(), puzzles: null },
    { ...index(), launchDate: "2026-02-30" },
    { ...index(), live: {} },
    { ...index(), puzzles: [{ id: "../../answer" }] },
    { ...index(), puzzles: [{ ...index().puzzles[0], number: Number.NaN }] },
    { ...index(), puzzles: [{ ...index().puzzles[0], actual: [] }] },
    { ...index(), puzzles: [{ ...index().puzzles[0], id: day(-1) }] },
    index([day(0), day(0)]),
    { ...index(), live: [{ ...index().live[0], charts: 2 }] },
    { ...index(), live: [{ ...index().live[0], resolved: "false" }] },
    { ...index(), live: [{ ...index().live[0], opensUtc: "yesterday" }] },
    { ...index(), live: [{ ...index().live[0], cutoffUtc: `${day(2)}T00:00:00Z` }] },
  ])("rejects malformed index %#", (input) => {
    expect(() => parsePuzzleIndex(input)).toThrow();
  });
});

describe("puzzle loading", () => {
  test("loads the local date directly in one round trip with a deployment prefix", async () => {
    const fetchPuzzle = transport();
    const onMissing = vi.fn();
    const loader = createPuzzleLoader(fetchPuzzle, "/game/");
    expect(await loader.loadToday(NOW, OFFSET_MIN, onMissing)).toEqual({
      kind: "ready",
      puzzle: puzzle(),
    });
    expect(fetchPuzzle.mock.calls).toEqual([[`/game/puzzles/${day(2)}/puzzle.json`]]);
    expect(onMissing).not.toHaveBeenCalled();
  });

  test("reports the 404 before requesting the index and opens the newest eligible puzzle on action", async () => {
    const events: string[] = [];
    const fetchPuzzle = vi.fn(async (url: string) => {
      events.push(url);
      if (url === TODAY_URL) return new Response(null, { status: 404 });
      return Response.json(url === INDEX_URL ? index() : puzzle(day(1)));
    });
    const loader = createPuzzleLoader(fetchPuzzle, "/");
    const state = await loader.loadToday(NOW, OFFSET_MIN, () => events.push("missing"));
    expect(events).toEqual([TODAY_URL, "missing", INDEX_URL]);
    expect(state.kind).toBe("missing");
    if (state.kind !== "missing") throw new Error("Expected missing state.");
    expect(state.what).toBe("Today's puzzle is not published yet.");
    expect(state.action.label).toBe("Play the latest puzzle");
    expect(await state.action.run()).toEqual({ kind: "ready", puzzle: puzzle(day(1)) });
    expect(events.at(-1)).toBe(`/puzzles/${day(1)}/puzzle.json`);
    expect(events.filter((event) => event === INDEX_URL)).toHaveLength(1);
  });

  test.each([500, 403, 200])(
    "does not request the index automatically on invalid response %s",
    async (status) => {
      const fetchPuzzle = transport({ ...puzzle(), actual: [] }, status);
      const missing = vi.fn();
      const state = await createPuzzleLoader(fetchPuzzle, "/").loadToday(NOW, OFFSET_MIN, missing);
      expect(state.kind).toBe("missing");
      expect(missing).toHaveBeenCalledWith(state);
      expect(fetchPuzzle.mock.calls).toEqual([[TODAY_URL]]);
    },
  );

  test.each(["network", "syntax", "identity"])(
    "handles %s failure without an index request",
    async (failure) => {
      const fetchPuzzle = vi.fn(async (_url: string) => {
        if (failure === "network") throw new TypeError("Connection failed.");
        return failure === "syntax" ? new Response("{bad json") : Response.json(puzzle(day(1)));
      });
      const state = await createPuzzleLoader(fetchPuzzle, "/").loadToday(NOW, OFFSET_MIN, vi.fn());
      expect(state.kind).toBe("missing");
      expect(fetchPuzzle.mock.calls).toEqual([[TODAY_URL]]);
    },
  );

  test.each(["archive", "interactive"] as const)(
    "loads index explicitly for %s",
    async (reason) => {
      const fetchPuzzle = transport(index());
      const loader = createPuzzleLoader(fetchPuzzle, "/");
      expect(fetchPuzzle).not.toHaveBeenCalled();
      expect(await loader.loadIndex(reason)).toEqual(index());
      expect(fetchPuzzle.mock.calls).toEqual([[INDEX_URL]]);
    },
  );

  test("before launch there is no request until the action is invoked", async () => {
    const fetchPuzzle = transport(index([]));
    const state = await createPuzzleLoader(fetchPuzzle, "/").loadToday(
      Date.parse(`${day(-1)}T12:00:00Z`),
      0,
      vi.fn(),
    );
    expect(fetchPuzzle).not.toHaveBeenCalled();
    if (state.kind !== "missing") throw new Error("Expected missing state.");
    expect(await state.action.run()).toBe(state);
    expect(fetchPuzzle.mock.calls).toEqual([[INDEX_URL]]);
  });

  test("retries an unavailable fallback index when the action runs", async () => {
    let indexRequests = 0;
    const fetchPuzzle = vi.fn(async (url: string) => {
      if (url === TODAY_URL) return new Response(null, { status: 404 });
      if (url !== INDEX_URL) return Response.json(puzzle(day(1)));
      indexRequests += 1;
      if (indexRequests === 1) throw new TypeError("Connection failed.");
      return Response.json(index());
    });
    const state = await createPuzzleLoader(fetchPuzzle, "/").loadToday(NOW, OFFSET_MIN, vi.fn());
    if (state.kind !== "missing") throw new Error("Expected missing state.");
    expect(await state.action.run()).toEqual({ kind: "ready", puzzle: puzzle(day(1)) });
    expect(indexRequests).toBe(2);
  });

  test.each(["empty", "future", "invalid", "failed", "bad-fallback"])(
    "keeps the fallback action usable for %s",
    async (failure) => {
      const fetchPuzzle = vi.fn(async (url: string) => {
        if (url === TODAY_URL || failure === "failed") return new Response(null, { status: 404 });
        if (url !== INDEX_URL) return Response.json({ ...puzzle(), actual: [] });
        if (failure === "invalid") return Response.json({ ...index(), launchDate: day(-1) });
        return Response.json(
          index(failure === "empty" ? [] : failure === "future" ? [day(3)] : [day(1)]),
        );
      });
      const state = await createPuzzleLoader(fetchPuzzle, "/").loadToday(NOW, OFFSET_MIN, vi.fn());
      if (state.kind !== "missing") throw new Error("Expected missing state.");
      expect(await state.action.run()).toBe(state);
    },
  );
});

test("the initial response is consumed once and explicit retries use the transport", async () => {
  const initial = new Response("initial");
  const retry = new Response("retry");
  const transport = vi.fn(async () => retry);
  const url = "./puzzles/2026-10-21/puzzle.json";
  const base = "https://example.test/forecastle/";
  const read = createInitialTransport(
    { url: new URL(url, base).href, response: Promise.resolve(initial) },
    transport,
    base,
  );
  expect(await read(url)).toBe(initial);
  expect(transport).not.toHaveBeenCalled();
  expect(await read(url)).toBe(retry);
  expect(transport).toHaveBeenCalledExactlyOnceWith(url);
});

test("an unrelated route cannot consume another puzzle's initial response", async () => {
  const response = new Response("initial");
  const transport = vi.fn(async () => new Response("other"));
  const base = "https://example.test/";
  const read = createInitialTransport(
    { url: `${base}puzzles/2026-10-21/puzzle.json`, response: Promise.resolve(response) },
    transport,
    base,
  );
  await read("./puzzles/index.json");
  expect(await read("./puzzles/2026-10-21/puzzle.json")).toBe(response);
  expect(transport).toHaveBeenCalledTimes(1);
});

test("an initial network error is returned once without caching a failed retry", async () => {
  const error = Response.error();
  const transport = vi.fn(async () => new Response("ok"));
  const url = "https://example.test/puzzles/2026-10-21/puzzle.json";
  const read = createInitialTransport({ url, response: Promise.resolve(error) }, transport, url);
  expect((await read(url)).ok).toBe(false);
  expect((await read(url)).ok).toBe(true);
  expect(transport).toHaveBeenCalledTimes(1);
});
