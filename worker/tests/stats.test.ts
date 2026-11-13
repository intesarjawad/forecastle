import { env } from "cloudflare:workers";
import { expect, test, vi } from "vitest";
import { k } from "../../scoring/constants.json";
import { summarize } from "../src/stats";
import { DAILY, LIVE, NOW, PATH, post, stats, submission } from "./runtime";

test("path percentiles and score quartiles use linear interpolation and calibrated Closeness", () => {
  const paths = [0, 1, 2, 4].map((value) => Array<number>(7).fill(value));
  const scores = [0, 1, 2, 4].map((value) => Math.round(100 * Math.max(0, 1 - value / (k * 2))));
  expect(summarize(paths, 4000, Array<number>(7).fill(0), 2)).toEqual({
    count: 4000,
    median: Array<number>(7).fill(1.5),
    p10: Array.from({ length: 7 }, () => expect.closeTo(0.3, 12)),
    p90: Array.from({ length: 7 }, () => expect.closeTo(3.4, 12)),
    quartiles: [
      (scores[3] ?? 0) * 0.25 + (scores[2] ?? 0) * 0.75,
      ((scores[2] ?? 0) + (scores[1] ?? 0)) / 2,
      (scores[1] ?? 0) * 0.75 + (scores[0] ?? 0) * 0.25,
    ],
  });
});

test("stats fetch the answer only on cache misses and never persist actual values", async () => {
  await post(submission());
  expect(fetch).toHaveBeenCalledTimes(2);
  const first = await (await stats()).json();
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(await (await stats()).json()).toEqual(first);
  expect(fetch).toHaveBeenCalledTimes(4);
  await post(submission());
  expect(await (await stats()).json()).toEqual(first);
  expect(fetch).toHaveBeenCalledTimes(6);
  const cache = await env.DB.prepare("SELECT body FROM stats_cache").first<{ body: string }>();
  expect(cache?.body).not.toContain("actual");
  vi.mocked(Date.now).mockReturnValue(NOW + 300_000);
  const refreshed = await (await stats()).json();
  expect(refreshed).toMatchObject({ count: 2, median: PATH });
  expect(fetch).toHaveBeenCalledTimes(8);
});

test("empty stats omit undefined percentiles instead of inventing scores", async () => {
  const response = await stats();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ count: 0, median: [], p10: [], p90: [] });
});

test("a missing resolved live answer returns paths without quartiles", async () => {
  await post(submission(LIVE));
  vi.mocked(Date.now).mockReturnValue(Date.parse("2026-11-11T00:00:00Z"));
  const original = vi.mocked(fetch).getMockImplementation();
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input).endsWith("answer.json")) return new Response(null, { status: 404 });
    if (!original) throw new Error("Missing static fixture");
    return original(input, init);
  });
  const response = await stats(LIVE);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ count: 1, median: PATH, p10: PATH, p90: PATH });
});

test("a malformed answer fails without caching fabricated stats", async () => {
  const original = vi.mocked(fetch).getMockImplementation();
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    if (String(input).endsWith("answer.json")) return Response.json({ id: DAILY, actual: [1] });
    if (!original) throw new Error("Missing static fixture");
    return original(input, init);
  });
  expect((await stats()).status).toBe(502);
  expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM stats_cache").first("n")).toBe(0);
});

test("cold stats over 5000 rows read at most 1010 rows; warm stats read at most 2", async () => {
  await env.DB.prepare(`WITH RECURSIVE numbers(n) AS (
    SELECT 1 UNION ALL SELECT n + 1 FROM numbers WHERE n < 5000
  ) INSERT INTO submissions
    (puzzle_id, client_id, d1, d2, d3, d4, d5, d6, d7, half_width, ms_to_lock, sample_key, created_at)
    SELECT ?, 'client-' || n,
      CASE WHEN n > 4000 THEN 1 ELSE 9 END,
      CASE WHEN n > 4000 THEN 2 ELSE 9 END,
      CASE WHEN n > 4000 THEN 3 ELSE 9 END,
      CASE WHEN n > 4000 THEN 4 ELSE 9 END,
      CASE WHEN n > 4000 THEN 5 ELSE 9 END,
      CASE WHEN n > 4000 THEN 6 ELSE 9 END,
      CASE WHEN n > 4000 THEN 7 ELSE 9 END,
      1, 1000, 5000 - n, ? FROM numbers`)
    .bind(DAILY, new Date(NOW).toISOString())
    .run();
  await env.DB.prepare("INSERT INTO puzzle_counts VALUES (?, 5000)").bind(DAILY).run();

  const statement = env.DB.prepare("SELECT 1");
  const prototype: D1PreparedStatement = Object.getPrototypeOf(statement);
  const originalAll = statement.all;
  const originalRun = statement.run;
  let rowsRead = 0;
  vi.spyOn(prototype, "all").mockImplementation(async function <T>(this: D1PreparedStatement) {
    const result = await originalAll.bind(this)<T>();
    rowsRead += result.meta.rows_read;
    return result;
  });
  vi.spyOn(prototype, "run").mockImplementation(async function <T>(this: D1PreparedStatement) {
    const result = await originalRun.bind(this)<T>();
    rowsRead += result.meta.rows_read;
    return result;
  });
  const cold = await stats();
  expect(cold.status).toBe(200);
  const body = await cold.json();
  expect(body).toMatchObject({ count: 5000, median: PATH, quartiles: [100, 100, 100] });
  expect(rowsRead).toBeGreaterThan(0);
  expect(rowsRead).toBeLessThanOrEqual(1010);
  rowsRead = 0;
  expect(await (await stats()).json()).toEqual(body);
  expect(rowsRead).toBeGreaterThan(0);
  expect(rowsRead).toBeLessThanOrEqual(2);
});
