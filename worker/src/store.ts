import type { Submission } from "./validate";

export type PathRow = Record<"d1" | "d2" | "d3" | "d4" | "d5" | "d6" | "d7", number>;

export function rowPath(row: PathRow): number[] {
  return [row.d1, row.d2, row.d3, row.d4, row.d5, row.d6, row.d7];
}

export async function storeSubmission(
  db: D1Database,
  submission: Submission,
  cap: number,
  now: number,
): Promise<201 | 202 | 409> {
  // The batch serializes the cap check and counter increment with the insert.
  const [insert] = await db.batch([
    db
      .prepare(`INSERT INTO submissions
      (puzzle_id, client_id, d1, d2, d3, d4, d5, d6, d7,
       half_width, ms_to_lock, sample_key, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE COALESCE((SELECT n FROM puzzle_counts WHERE puzzle_id = ?), 0) < ?
      ON CONFLICT (puzzle_id, client_id) DO NOTHING`)
      .bind(
        submission.puzzleId,
        submission.clientId,
        ...submission.path,
        submission.halfWidth,
        submission.msToLock,
        (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) >>> 1,
        new Date(now).toISOString(),
        submission.puzzleId,
        cap,
      ),
    // changes() refers to the preceding insert, including its conflict/cap outcome.
    db
      .prepare(`INSERT INTO puzzle_counts (puzzle_id, n)
      SELECT ?, 1 WHERE changes() > 0
      ON CONFLICT (puzzle_id) DO UPDATE SET n = n + 1`)
      .bind(submission.puzzleId),
  ]);
  if (insert?.meta.changes === 1) return 201;
  const duplicate = await db
    .prepare("SELECT 1 FROM submissions WHERE puzzle_id = ? AND client_id = ?")
    .bind(submission.puzzleId, submission.clientId)
    .first();
  return duplicate ? 409 : 202;
}
