import { reset } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, expect, vi } from "vitest";
import schema from "../schema.sql?raw";

export const NOW = Date.parse("2026-11-05T12:00:00Z");
export const DAILY = "2026-11-05";
export const LIVE = "live-2026-11-02-1";
export const PATH = [1, 2, 3, 4, 5, 6, 7];

export function submission(puzzleId = DAILY) {
  return { puzzleId, clientId: crypto.randomUUID(), path: PATH, halfWidth: 1, msToLock: 1500 };
}

export function post(body: unknown) {
  return exports.default.fetch("https://worker.test/v1/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
}

export function stats(id = DAILY) {
  return exports.default.fetch(`https://worker.test/v1/stats/${id}`);
}

export function puzzle(id: string) {
  return {
    id,
    yDomain: [-10, 10],
    typicalMove: 2,
    ...(id.startsWith("live-")
      ? {
          cutoffUtc: "2026-11-05T13:00:00Z",
          resolvesUtc: "2026-11-11T00:00:00Z",
        }
      : {}),
  };
}

beforeEach(async () => {
  await reset();
  await env.DB.batch(
    schema
      .split(";")
      .filter((sql) => sql.trim())
      .map((sql) => env.DB.prepare(sql)),
  );
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    // Building the Request applies the runtime's own option checks, as a real fetch would.
    const url = new URL(new Request(input, init).url);
    expect(url.origin).toBe(new URL(env.PAGES_URL).origin);
    const id = url.pathname.startsWith("/live/") ? LIVE : url.pathname.split("/")[2];
    if (!id) return new Response(null, { status: 404 });
    return Response.json(url.pathname.endsWith("answer.json") ? { id, actual: PATH } : puzzle(id));
  });
});

afterEach(() => vi.restoreAllMocks());
