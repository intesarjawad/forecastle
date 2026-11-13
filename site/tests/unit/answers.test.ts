import { afterEach, expect, test, vi } from "vitest";
import { loadAnswer, parseAnswer } from "../../src/io/answers";
import answer from "../fixtures/2026-10-21/answer.json" with { type: "json" };

afterEach(() => vi.unstubAllGlobals());

test("parses recorded real values and all calendar dates", () => {
  expect(parseAnswer(answer, "2026-10-21")).toEqual({
    id: "2026-10-21",
    actual: [20.8, 19.8, 15.2, 17.5, 17, 18.6, 21.5],
    dates: answer.dates,
  });
});

test.each([
  null,
  { ...answer, id: "2026-10-22" },
  { ...answer, actual: [1, 2] },
  { ...answer, actual: [1, 2, 3, 4, 5, 6, Infinity] },
  { ...answer, actual: [1, 2, 3, 4, 5, 6, 1e101] },
  { ...answer, actual: [1, 2, 3, 4, 5, 6, "7"] },
  { ...answer, dates: ["2026-05-01"] },
  { ...answer, dates: ["2026-02-30", ...answer.dates.slice(1)] },
  { ...answer, dates: ["2026-04-29", ...answer.dates.slice(1)] },
  { ...answer, dates: ["2026-04-30T00:00:00Z", ...answer.dates.slice(1)] },
])("rejects malformed answers %j", (value) => {
  expect(() => parseAnswer(value, "2026-10-21")).toThrow();
});

test("makes no request until called, then loads and validates the requested answer", async () => {
  const fetchAnswer = vi.fn().mockResolvedValue(Response.json(answer));
  vi.stubGlobal("fetch", fetchAnswer);
  expect(fetchAnswer).not.toHaveBeenCalled();
  await expect(loadAnswer("2026-10-21")).resolves.toMatchObject({ id: "2026-10-21" });
  expect(fetchAnswer).toHaveBeenCalledExactlyOnceWith("/puzzles/2026-10-21/answer.json");
});

test("rejects failed responses and invalid JSON data", async () => {
  const fetchAnswer = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json({}));
  vi.stubGlobal("fetch", fetchAnswer);
  await expect(loadAnswer("2026-10-21")).rejects.toThrow("Answer request failed (503)");
  await expect(loadAnswer("2026-10-21")).rejects.toThrow("Answer id");
});
