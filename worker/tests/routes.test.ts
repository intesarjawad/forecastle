import { env, exports } from "cloudflare:workers";
import { expect, test, vi } from "vitest";
import { DAILY, LIVE, NOW, PATH, post, puzzle, stats, submission } from "./runtime";

test("daily submit stores a path and returns the same stats as GET", async () => {
  const response = await post(submission());
  expect(response.status).toBe(201);
  const body = await response.json();
  expect(body).toEqual({ stored: true, stats: await (await stats()).json() });
  expect(body).toEqual({
    stored: true,
    stats: { count: 1, median: PATH, p10: PATH, p90: PATH, quartiles: [100, 100, 100] },
  });
  const rows = await env.DB.prepare("SELECT * FROM submissions").all();
  expect(rows.results).toHaveLength(1);
  expect(rows.results[0]).toMatchObject({
    puzzle_id: DAILY,
    d1: 1,
    d7: 7,
    half_width: 1,
    ms_to_lock: 1500,
  });
  expect(rows.results[0]?.sample_key).toBeGreaterThanOrEqual(0);
  expect(rows.results[0]?.sample_key).toBeLessThan(2 ** 31);
  expect(rows.results[0]).not.toHaveProperty("score");
  expect(await env.DB.prepare("SELECT n FROM puzzle_counts").first("n")).toBe(1);
});

test("duplicate returns 409 with cached daily stats, without incrementing count", async () => {
  const entry = submission();
  await post(entry);
  const response = await post({ ...entry, clientId: entry.clientId.toUpperCase() });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ stats: await (await stats()).json() });
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM submissions").first("n")).toBe(1);
  expect(await env.DB.prepare("SELECT n FROM puzzle_counts").first("n")).toBe(1);
});

test("daily cap returns 202 with stats and no extra row; duplicates remain 409 at cap", async () => {
  const first = submission();
  await post(first);
  await post(submission());
  await post(submission());
  const response = await post(submission());
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ stored: false, stats: await (await stats()).json() });
  expect((await post(first)).status).toBe(409);
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM submissions").first("n")).toBe(3);
  expect(await env.DB.prepare("SELECT n FROM puzzle_counts").first("n")).toBe(3);
});

test("concurrent submits cannot exceed the daily cap", async () => {
  const responses = await Promise.all(Array.from({ length: 8 }, () => post(submission())));
  expect(responses.filter((response) => response.status === 201)).toHaveLength(3);
  expect(responses.filter((response) => response.status === 202)).toHaveLength(5);
  expect(await env.DB.prepare("SELECT n FROM puzzle_counts").first("n")).toBe(3);
});

test.each([
  null,
  { path: [1, 2] },
  { path: [1, 2, 3, 4, 5, 6, null] },
  { path: [1, 2, 3, 4, 5, 6, 11] },
  { clientId: "invalid" },
  { halfWidth: 0.49 },
  { halfWidth: 16.01 },
  { msToLock: -1 },
  { msToLock: 0.5 },
  { msToLock: 3_600_001 },
  { puzzleId: "2026-11-03" },
  { puzzleId: "2026-11-07" },
  { puzzleId: "2026-02-30" },
  { puzzleId: "live-2026-11-02-4" },
  { puzzleId: "../../secret" },
])("invalid submission is rejected: %j", async (patch) => {
  const response = await post(patch === null ? null : { ...submission(), ...patch });
  expect(response.status).toBe(400);
});

test("missing fields and malformed JSON return 400", async () => {
  expect((await post({})).status).toBe(400);
  const response = await exports.default.fetch("https://worker.test/v1/submit", {
    method: "POST",
    headers: { "CF-Connecting-IP": "192.0.2.1" },
    body: "{",
  });
  expect(response.status).toBe(400);
});

test.each([0.5, 16])("halfWidth boundary %s is accepted", async (halfWidth) => {
  expect((await post({ ...submission(), halfWidth })).status).toBe(201);
});

test("live submissions have no stats and are uncapped", async () => {
  for (let i = 0; i < 4; i++) {
    const response = await post(submission(LIVE));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ stored: true });
  }
  expect(
    vi.mocked(fetch).mock.calls.every(([input]) => String(input).endsWith("puzzle.json")),
  ).toBe(true);
});

test("live duplicate has no stats", async () => {
  const entry = submission(LIVE);
  await post(entry);
  const response = await post(entry);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({});
});

test("live submissions at and after cutoff return 409 without storing", async () => {
  for (const time of ["2026-11-05T13:00:00Z", "2026-11-05T14:00:00Z"]) {
    vi.mocked(Date.now).mockReturnValue(Date.parse(time));
    expect((await post(submission(LIVE))).status).toBe(409);
  }
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM submissions").first("n")).toBe(0);
});

test("live stats are hidden until resolution, even with a populated cache", async () => {
  await env.DB.prepare("INSERT INTO stats_cache VALUES (?, ?, ?)")
    .bind(LIVE, "{}", new Date(NOW).toISOString())
    .run();
  expect((await stats(LIVE)).status).toBe(403);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("resolved live stats use the correct static answer path", async () => {
  await post(submission(LIVE));
  vi.mocked(Date.now).mockReturnValue(Date.parse("2026-11-11T00:00:00Z"));
  const response = await stats(LIVE);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ count: 1, quartiles: [100, 100, 100] });
  expect(fetch).toHaveBeenCalledWith(
    new URL(`${env.PAGES_URL}live/live-2026-11-02/1/answer.json`),
    { redirect: "manual" },
  );
});

test("export requires the bearer token and returns D1 rows without client ids", async () => {
  const entry = submission();
  await post(entry);
  const url = `https://worker.test/v1/export/${DAILY}`;
  expect((await exports.default.fetch(url)).status).toBe(401);
  expect(
    (await exports.default.fetch(url, { headers: { Authorization: "Bearer wrong" } })).status,
  ).toBe(401);
  const response = await exports.default.fetch(url, {
    headers: { Authorization: "Bearer test-token" },
  });
  expect(response.status).toBe(200);
  const body = await response.json<{ submissions: Record<string, unknown>[] }>();
  expect(body.submissions).toHaveLength(1);
  expect(body.submissions[0]).toMatchObject({ puzzle_id: DAILY, d1: 1, d7: 7 });
  expect(body.submissions[0]).not.toHaveProperty("client_id");
  expect(JSON.stringify(body)).not.toContain(entry.clientId);
});

test("share is not a route", async () => {
  const response = await exports.default.fetch("https://worker.test/v1/share", { method: "POST" });
  expect(response.status).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
});

test("version reports the bound SHA and D1 state, with no caching", async () => {
  const response = await exports.default.fetch("https://worker.test/v1/version");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ sha: "test-sha", db: "ok" });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  await env.DB.exec("DROP TABLE submissions");
  const failed = await exports.default.fetch("https://worker.test/v1/version");
  expect(failed.status).toBe(503);
  expect(await failed.json()).toEqual({ sha: "test-sha", db: "error" });
  expect(failed.headers.get("Cache-Control")).toBe("no-store");
});

test("CORS permits only the configured Pages origin and supports preflight", async () => {
  for (const origin of [new URL(env.PAGES_URL).origin, "https://other.test"]) {
    const allowed = origin === new URL(env.PAGES_URL).origin;
    const response = await exports.default.fetch("https://worker.test/v1/version", {
      headers: { Origin: origin },
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(allowed ? origin : null);
    const preflight = await exports.default.fetch("https://worker.test/v1/submit", {
      method: "OPTIONS",
      headers: { Origin: origin },
    });
    expect(preflight.status).toBe(allowed ? 204 : 403);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(allowed ? origin : null);
  }
});

test("POST rate limiting uses the connecting IP; GETs remain available", async () => {
  const ip = "192.0.2.60";
  for (let i = 0; i < 60; i++) {
    const response = await exports.default.fetch("https://worker.test/v1/submit", {
      method: "POST",
      headers: { "CF-Connecting-IP": ip },
      body: "{}",
    });
    expect(response.status).toBe(400);
  }
  const limited = await exports.default.fetch("https://worker.test/v1/submit", {
    method: "POST",
    headers: { "CF-Connecting-IP": ip },
    body: "{}",
  });
  expect(limited.status).toBe(429);
  expect(limited.headers.get("Retry-After")).toBe("60");
  expect(
    (
      await exports.default.fetch("https://worker.test/v1/version", {
        headers: { "CF-Connecting-IP": ip },
      })
    ).status,
  ).toBe(200);
  expect((await post(submission())).status).toBe(201);
});

test("missing, redirected or invalid static files do not store submissions", async () => {
  vi.mocked(fetch).mockImplementationOnce(async () => new Response(null, { status: 404 }));
  expect((await post(submission())).status).toBe(404);
  vi.mocked(fetch).mockImplementationOnce(
    async () =>
      new Response(null, { status: 302, headers: { Location: "https://elsewhere.test/" } }),
  );
  expect((await post(submission())).status).toBe(502);
  vi.mocked(fetch).mockImplementationOnce(async () =>
    Response.json({ ...puzzle(DAILY), typicalMove: 0 }),
  );
  expect((await post(submission())).status).toBe(502);
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM submissions").first("n")).toBe(0);
});
