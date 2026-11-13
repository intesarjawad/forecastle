import { afterEach, describe, expect, test, vi } from "vitest";
import type { Stats } from "../../src/core/history";
import { shareText } from "../../src/core/share";
import { type CrowdResult, createSubmission, submissionId } from "../../src/io/submissions";

const STATS = {
  count: 12,
  median: [1, 2, 3, 4, 5, 6, 7],
  p10: [0, 0, 0, 0, 0, 0, 0],
  p90: [8, 8, 8, 8, 8, 8, 8],
  quartiles: [25, 50, 75],
};
const FORECAST = { path: [1, 2, 3, 4, 5, 6, 7], halfWidth: 1, msToLock: 1200 };
const CONFIG = { workerUrl: "https://crowd.example/", submitRateSchedule: [] };
const SECRET_KEY = "forecastle.v1.secret";
const OPT_OUT_KEY = "forecastle.v1.crowdOptOut";

function setup(
  options: {
    kind?: "daily" | "live" | "custom";
    optOut?: boolean;
    previous?: { stats: unknown };
    config?:
      | typeof CONFIG
      | { workerUrl: string; submitRateSchedule: { from: string; to: string; rate: number }[] };
    fetch?: (url: string, init: RequestInit) => Promise<Response>;
  } = {},
) {
  const values = new Map<string, string>();
  if (options.optOut) values.set(OPT_OUT_KEY, "true");
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
  };
  let finish: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const saveStats = vi.fn((_stats: Stats | null) => finish());
  const onResult = vi.fn((_result: CrowdResult) => {});
  const fetch = vi.fn(
    options.fetch ??
      (async () =>
        Response.json(options.optOut ? STATS : { stored: true, stats: STATS }, {
          status: options.optOut ? 200 : 201,
        })),
  );
  const random = vi.fn(() => 0.5);
  const dependencies = { fetch, storage, crypto: globalThis.crypto, random };
  const play = {
    puzzleId: options.kind === "live" ? "live-2026-12-01-1" : "2026-12-01",
    kind: options.kind ?? "daily",
    utcDate: "2026-12-01",
    saveStats,
    onResult,
    ...(options.previous === undefined ? {} : { previous: options.previous }),
  };
  const submission = createSubmission(play, dependencies, options.config ?? CONFIG);
  return {
    submission,
    dependencies,
    play,
    done,
    saveStats,
    onResult,
    fetch,
    random,
    values,
    storage,
  };
}

afterEach(() => vi.useRealTimers());

test("HMAC ids are stable per puzzle, distinct across puzzles and UUID v4 shaped", async () => {
  const secret = Uint8Array.from({ length: 32 }, (_, index) => index);
  const first = await submissionId(secret, "2026-12-01", crypto.subtle);
  expect(first).toBe(await submissionId(secret, "2026-12-01", crypto.subtle));
  expect(first).not.toBe(await submissionId(secret, "2026-12-02", crypto.subtle));
  expect(first).not.toBe(await submissionId(new Uint8Array(32), "2026-12-01", crypto.subtle));
  expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const key = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("2026-12-01")),
  );
  const bytes = Uint8Array.from(first.replaceAll("-", "").match(/../g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
  bytes[6] = digest[6] ?? 0;
  bytes[8] = digest[8] ?? 0;
  expect(bytes).toEqual(digest.slice(0, 16));
});

describe("daily submission", () => {
  test.each([201, 202, 409])(
    "uses one POST and saves response stats for status %s",
    async (status) => {
      const h = setup({ fetch: async () => Response.json({ stats: STATS }, { status }) });
      expect(h.submission.lock(FORECAST)).toBeUndefined();
      h.submission.lock(FORECAST);
      await h.done;
      expect(h.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = h.fetch.mock.calls[0] ?? [];
      expect(url).toBe("https://crowd.example/v1/submit");
      expect(init).toMatchObject({
        method: "POST",
        credentials: "omit",
        redirect: "error",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
      });
      const body: unknown = JSON.parse(String(init?.body));
      expect(body).toEqual({ puzzleId: "2026-12-01", clientId: expect.any(String), ...FORECAST });
      expect(String(init?.body)).not.toContain(h.values.get(SECRET_KEY));
      expect(h.values.get(SECRET_KEY)).toMatch(/^[0-9a-f]{64}$/);
      expect(h.saveStats).toHaveBeenCalledWith(STATS);
      expect(h.submission.result).toEqual({ kind: "hidden" });
      expect(h.onResult).not.toHaveBeenCalled();
      h.submission.reveal();
      expect(h.submission.result).toEqual({ kind: "ready", stats: STATS });
      expect(h.onResult).toHaveBeenCalledWith({ kind: "ready", stats: STATS });
      expect(h.fetch).toHaveBeenCalledTimes(1);
    },
  );

  test("reuses the stored secret on a different puzzle without transmitting it", async () => {
    const h = setup();
    h.submission.lock(FORECAST);
    await h.done;
    const secret = h.values.get(SECRET_KEY);
    const next = createSubmission({ ...h.play, puzzleId: "2026-12-02" }, h.dependencies, CONFIG);
    next.lock(FORECAST);
    await vi.waitFor(() => expect(h.fetch).toHaveBeenCalledTimes(2));
    expect(h.values.get(SECRET_KEY)).toBe(secret);
    expect(h.storage.setItem).toHaveBeenCalledTimes(1);
    expect(h.fetch.mock.calls[0]?.[1].body).not.toBe(h.fetch.mock.calls[1]?.[1].body);
  });

  test("copies the forecast before asynchronous signing", async () => {
    const h = setup();
    const path = [...FORECAST.path];
    h.submission.lock({ ...FORECAST, path });
    path[0] = 999;
    await h.done;
    expect(JSON.parse(String(h.fetch.mock.calls[0]?.[1].body))).toMatchObject({
      path: FORECAST.path,
    });
  });

  test("the opt-out switch replaces POST with one GET without accessing the secret", async () => {
    const h = setup({ optOut: true });
    h.submission.lock(FORECAST);
    h.submission.lock(FORECAST);
    await h.done;
    h.submission.reveal();
    expect(h.fetch).toHaveBeenCalledExactlyOnceWith(
      "https://crowd.example/v1/stats/2026-12-01",
      expect.objectContaining({ method: "GET" }),
    );
    expect(h.saveStats).toHaveBeenCalledWith(STATS);
    expect(h.storage.getItem.mock.calls).toEqual([[OPT_OUT_KEY]]);
    expect(h.storage.setItem).not.toHaveBeenCalled();
  });

  test.each([
    ["2026-11-30", "POST"],
    ["2026-12-02", "POST"],
    ["2026-11-29", "GET"],
  ])("a daily play of %s on 2026-12-01 sends %s", async (puzzleId, method) => {
    const h = setup();
    const submission = createSubmission(
      { ...h.play, puzzleId, kind: "daily" },
      h.dependencies,
      CONFIG,
    );
    submission.lock(FORECAST);
    await h.done;
    expect(h.fetch).toHaveBeenCalledExactlyOnceWith(
      method === "GET"
        ? `https://crowd.example/v1/stats/${puzzleId}`
        : "https://crowd.example/v1/submit",
      expect.objectContaining({ method }),
    );
    if (method === "GET") expect(h.storage.setItem).not.toHaveBeenCalled();
  });

  test.each([false, true])("samples daily requests with opt-out %s", async (optOut) => {
    const h = setup({
      optOut,
      config: {
        ...CONFIG,
        submitRateSchedule: [{ from: "2026-12-01", to: "2026-12-05", rate: 0.25 }],
      },
    });
    h.submission.lock(FORECAST);
    await h.done;
    h.submission.reveal();
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.storage.setItem).not.toHaveBeenCalled();
    expect(h.submission.result).toEqual({
      kind: "sampled-out",
      what: "Busy day: the crowd line is shown to a share of players today. Your score is not affected.",
    });
    expect(h.saveStats).toHaveBeenCalledWith(null);
  });

  test("a random draw equal to the rate is sampled out", async () => {
    const h = setup({
      config: {
        ...CONFIG,
        submitRateSchedule: [{ from: "2026-12-01", to: "2026-12-05", rate: 0.5 }],
      },
    });
    h.submission.lock(FORECAST);
    await h.done;
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

test.each(["live", "custom"] as const)("%s does not sample", async (kind) => {
  const h = setup({
    kind,
    config: { ...CONFIG, submitRateSchedule: [{ from: "2026-12-01", to: "2026-12-05", rate: 0 }] },
  });
  h.submission.lock(FORECAST);
  await h.done;
  h.submission.reveal();
  expect(h.random).not.toHaveBeenCalled();
  expect(h.fetch).toHaveBeenCalledTimes(kind === "live" ? 1 : 0);
  expect(h.submission.result).toEqual({ kind: kind === "live" ? "entered" : "skipped" });
});

test("a live round posts despite a daily request share", async () => {
  const h = setup({
    kind: "live",
    config: {
      ...CONFIG,
      submitRateSchedule: [{ from: "2026-12-01", to: "2026-12-05", rate: 0.25 }],
    },
  });
  h.submission.lock(FORECAST);
  await h.done;
  h.submission.reveal();
  expect(h.random).not.toHaveBeenCalled();
  expect(h.fetch).toHaveBeenCalledTimes(1);
  expect(h.submission.result).toEqual({ kind: "entered" });
});

test("live opt-out makes no request and keeps the entry local", async () => {
  const h = setup({ kind: "live", optOut: true });
  h.submission.lock(FORECAST);
  await h.done;
  h.submission.reveal();
  expect(h.fetch).not.toHaveBeenCalled();
  expect(h.submission.result).toEqual({ kind: "kept" });
});

test("a live entry posts its chart id, path, band and time to lock, with no stats key read", async () => {
  const h = setup({
    kind: "live",
    fetch: async () => Response.json({ stored: true }, { status: 201 }),
  });
  h.submission.lock(FORECAST);
  await h.done;
  const [url, init] = h.fetch.mock.calls[0] ?? [];
  expect(url).toBe("https://crowd.example/v1/submit");
  expect(init?.method).toBe("POST");
  const body = JSON.parse(String(init?.body));
  expect(body).toEqual({ puzzleId: "live-2026-12-01-1", clientId: body.clientId, ...FORECAST });
  expect(body.clientId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  expect(h.saveStats).toHaveBeenCalledWith(null);
});

test.each([
  ["a duplicate", 409, {}, "duplicate"],
  ["a cutoff refusal", 409, { error: "Entries are closed" }, "closed"],
  ["a rate limit", 429, { error: "Too many submissions" }, "busy"],
  ["a database outage", 503, { error: "Service unavailable" }, "busy"],
  ["a missing chart", 404, { error: "Puzzle not found" }, "busy"],
] as const)("a live response of %s reads as %s", async (_name, status, body, kind) => {
  const h = setup({ kind: "live", fetch: async () => Response.json(body, { status }) });
  h.submission.lock(FORECAST);
  await h.done;
  h.submission.reveal();
  expect(h.submission.result).toEqual({ kind });
});

test("a live entry that cannot reach the Worker is unavailable", async () => {
  const h = setup({
    kind: "live",
    fetch: async () => {
      throw new TypeError("Failed to fetch");
    },
  });
  h.submission.lock(FORECAST);
  await h.done;
  h.submission.reveal();
  expect(h.submission.result).toEqual({ kind: "unavailable" });
});

test("an empty deployment URL makes no request or storage access", async () => {
  const h = setup({ config: { ...CONFIG, workerUrl: "" } });
  h.submission.lock(FORECAST);
  await h.done;
  expect(h.fetch).not.toHaveBeenCalled();
  expect(h.storage.getItem).not.toHaveBeenCalled();
});

test.each([STATS, null, { count: -1 }])("a restored play makes no request %#", (stats) => {
  const h = setup({ previous: { stats } });
  h.submission.lock(FORECAST);
  h.submission.reveal();
  expect(h.fetch).not.toHaveBeenCalled();
  expect(h.storage.getItem).not.toHaveBeenCalled();
  expect(h.saveStats).not.toHaveBeenCalled();
  expect(h.submission.result).toEqual(
    stats === STATS ? { kind: "ready", stats: STATS } : { kind: "unavailable" },
  );
});

test("reveal and share complete while a blocked route is pending, then timeout aborts once", async () => {
  vi.useFakeTimers();
  const h = setup({ optOut: true, fetch: () => new Promise(() => {}) });
  h.submission.lock(FORECAST);
  h.submission.reveal();
  expect(h.submission.result).toEqual({ kind: "pending" });
  const requests = h.fetch.mock.calls.length;
  expect(
    shareText({
      kind: "daily",
      number: 1,
      you: 90,
      ai: 80,
      youCells: [],
      aiCells: [],
      bandCaught: 7,
      link: "https://game.example",
    }),
  ).toContain("Forecastle #1");
  expect(h.fetch).toHaveBeenCalledTimes(requests);
  const signal = h.fetch.mock.calls[0]?.[1].signal;
  await vi.advanceTimersByTimeAsync(2999);
  expect(signal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await h.done;
  expect(signal?.aborted).toBe(true);
  expect(h.submission.result).toEqual({ kind: "unavailable" });
  expect(h.fetch).toHaveBeenCalledTimes(1);
  expect(h.saveStats).toHaveBeenCalledWith(null);
});

test("a response arriving after reveal publishes and saves validated stats", async () => {
  let respond: (response: Response) => void = () => {};
  const h = setup({
    optOut: true,
    fetch: () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  });
  h.submission.lock(FORECAST);
  h.submission.reveal();
  respond(Response.json(STATS));
  await h.done;
  expect(h.onResult).toHaveBeenLastCalledWith({ kind: "ready", stats: STATS });
});

test.each(["network", "json", "shape", "status", "secret", "storage"])(
  "%s failure stays local without retry",
  async (failure) => {
    const h = setup({
      fetch: async () => {
        if (failure === "network") throw new TypeError("Network unavailable.");
        if (failure === "json") return new Response("{");
        return Response.json(
          { stats: failure === "shape" ? {} : STATS },
          { status: failure === "status" ? 503 : 201 },
        );
      },
    });
    if (failure === "secret") h.values.set(SECRET_KEY, "invalid");
    if (failure === "storage")
      h.storage.getItem.mockImplementation(() => {
        throw new Error("Storage blocked.");
      });
    h.submission.lock(FORECAST);
    h.submission.reveal();
    await h.done;
    expect(h.submission.result).toEqual({ kind: "unavailable" });
    expect(h.saveStats).toHaveBeenCalledWith(null);
    expect(h.fetch).toHaveBeenCalledTimes(failure === "secret" || failure === "storage" ? 0 : 1);
  },
);
