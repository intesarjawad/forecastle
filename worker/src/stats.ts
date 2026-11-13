import { k } from "../../scoring/constants.json";
import { closeness } from "../../site/src/core/scoring";
import { HttpError, puzzleFileUrl } from "./puzzles";
import { type PathRow, rowPath } from "./store";
import { finiteArray, HORIZON, isObject, type Puzzle } from "./validate";

const CACHE_TTL_MS = 300_000;
const SAMPLE_SIZE = 1000;

function percentile(sorted: readonly number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction;
  const lower = sorted[Math.floor(position)] ?? 0;
  const upper = sorted[Math.ceil(position)] ?? lower;
  return lower + (upper - lower) * (position % 1);
}

export function summarize(paths: number[][], count: number, actual: number[] | null, move: number) {
  const columns = Array.from({ length: HORIZON }, (_, day) =>
    paths.map((path) => path[day] ?? 0).sort((a, b) => a - b),
  );
  const pathAt = (fraction: number) =>
    paths.length ? columns.map((column) => percentile(column, fraction)) : [];
  const scores = actual
    ? paths.map((path) => closeness(path, actual, move, k)).sort((a, b) => a - b)
    : [];
  return {
    count,
    median: pathAt(0.5),
    p10: pathAt(0.1),
    p90: pathAt(0.9),
    ...(scores.length ? { quartiles: [0.25, 0.5, 0.75].map((q) => percentile(scores, q)) } : {}),
  };
}

export async function statsBody(
  db: D1Database,
  pagesUrl: string,
  id: string,
  puzzle: Puzzle,
  now: number,
): Promise<unknown> {
  const cached = await db
    .prepare("SELECT body, computed_at FROM stats_cache WHERE puzzle_id = ?")
    .bind(id)
    .all<{ body: string; computed_at: string }>();
  const cache = cached.results[0];
  if (cache && now - Date.parse(cache.computed_at) < CACHE_TTL_MS) return JSON.parse(cache.body);

  const response = await fetch(puzzleFileUrl(pagesUrl, id, "answer.json"), { redirect: "manual" });
  let actual: number[] | null = null;
  if (response.ok) {
    const answer: unknown = await response.json();
    if (!isObject(answer) || answer.id !== id || !finiteArray(answer.actual, HORIZON)) {
      throw new HttpError(502, "Invalid answer file");
    }
    actual = answer.actual;
  } else if (response.status !== 404) {
    throw new HttpError(502, "Answer unavailable");
  }
  const [sample, counter] = await Promise.all([
    db
      .prepare(`SELECT d1, d2, d3, d4, d5, d6, d7 FROM submissions
      WHERE puzzle_id = ? ORDER BY sample_key LIMIT ${SAMPLE_SIZE}`)
      .bind(id)
      .all<PathRow>(),
    db.prepare("SELECT n FROM puzzle_counts WHERE puzzle_id = ?").bind(id).all<{ n: number }>(),
  ]);
  const paths = sample.results.map(rowPath);
  const body = summarize(paths, counter.results[0]?.n ?? 0, actual, puzzle.typicalMove);
  await db
    .prepare(`INSERT INTO stats_cache (puzzle_id, body, computed_at) VALUES (?, ?, ?)
    ON CONFLICT (puzzle_id) DO UPDATE SET body = excluded.body, computed_at = excluded.computed_at`)
    .bind(id, JSON.stringify(body), new Date(now).toISOString())
    .run();
  return body;
}
