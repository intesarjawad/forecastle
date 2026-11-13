import { HttpError, loadPuzzle } from "./puzzles";
import { statsBody } from "./stats";
import { storeSubmission } from "./store";
import { fitsPuzzle, parseSubmission, validPuzzleId } from "./validate";

async function submit(request: Request, env: Cloudflare.Env, now: number): Promise<Response> {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) throw new HttpError(400, "Missing connecting address");
  if (!(await env.SUBMIT_LIMIT.limit({ key: ip })).success) {
    return Response.json(
      { error: "Too many submissions" },
      {
        status: 429,
        headers: { "Retry-After": "60" },
      },
    );
  }
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
  const submission = parseSubmission(value, now);
  if (!submission) throw new HttpError(400, "Invalid submission");
  const puzzle = await loadPuzzle(env.PAGES_URL, submission.puzzleId);
  if (!fitsPuzzle(submission, puzzle)) throw new HttpError(400, "Submission outside puzzle bounds");
  if (puzzle.cutoffUtc && now >= Date.parse(puzzle.cutoffUtc)) {
    throw new HttpError(409, "Entries are closed");
  }
  const live = submission.puzzleId.startsWith("live-");
  const status = await storeSubmission(
    env.DB,
    submission,
    live ? Number.MAX_SAFE_INTEGER : env.DAILY_STORE_CAP,
    now,
  );
  const stored = status === 409 ? {} : { stored: status === 201 };
  if (live) return Response.json(stored, { status });
  const stats = await statsBody(env.DB, env.PAGES_URL, submission.puzzleId, puzzle, now);
  return Response.json({ ...stored, stats }, { status });
}

async function route(request: Request, env: Cloudflare.Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (request.method === "GET" && pathname === "/v1/version") {
    try {
      await env.DB.prepare("SELECT 1 FROM submissions LIMIT 1").first();
      return Response.json({ sha: env.GIT_SHA, db: "ok" });
    } catch {
      return Response.json({ sha: env.GIT_SHA, db: "error" }, { status: 503 });
    }
  }
  const now = Date.now();
  if (request.method === "POST" && pathname === "/v1/submit") return submit(request, env, now);
  const match = /^\/v1\/(stats|export)\/([^/]+)$/.exec(pathname);
  const id = match?.[2];
  if (request.method !== "GET" || !match || !id) return new Response("Not found", { status: 404 });
  if (match[1] === "export") {
    if (
      !env.EXPORT_TOKEN ||
      request.headers.get("Authorization") !== `Bearer ${env.EXPORT_TOKEN}`
    ) {
      throw new HttpError(401, "Unauthorized");
    }
    if (!validPuzzleId(id)) throw new HttpError(400, "Invalid puzzle id");
    const result = await env.DB.prepare(`SELECT id, puzzle_id, d1, d2, d3, d4, d5, d6, d7,
      half_width, ms_to_lock, sample_key, created_at FROM submissions
      WHERE puzzle_id = ? ORDER BY id`)
      .bind(id)
      .all();
    return Response.json({ submissions: result.results });
  }
  if (!validPuzzleId(id)) throw new HttpError(400, "Invalid puzzle id");
  const puzzle = await loadPuzzle(env.PAGES_URL, id);
  if (puzzle.resolvesUtc && now < Date.parse(puzzle.resolvesUtc)) {
    throw new HttpError(403, "Stats are hidden until resolution");
  }
  return Response.json(await statsBody(env.DB, env.PAGES_URL, id, puzzle, now));
}

export default {
  async fetch(request, env): Promise<Response> {
    const allowedOrigin = new URL(env.PAGES_URL).origin;
    const origin = request.headers.get("Origin");
    let response: Response;
    try {
      if (request.method === "OPTIONS") {
        response = new Response(null, { status: origin === allowedOrigin ? 204 : 403 });
      } else {
        response = await route(request, env);
      }
    } catch (error) {
      response =
        error instanceof HttpError
          ? Response.json({ error: error.message }, { status: error.status })
          : Response.json({ error: "Service unavailable" }, { status: 503 });
    }
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Vary", "Origin");
    if (origin === allowedOrigin) {
      response.headers.set("Access-Control-Allow-Origin", allowedOrigin);
      response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
    return response;
  },
} satisfies ExportedHandler<Cloudflare.Env>;
