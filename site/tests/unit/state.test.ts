import { expect, test } from "vitest";
import { type MatchEvent, type MatchState, transition } from "../../src/core/state";

const path = [10, 20, 30, 40, 50, 60, 70];
const forecast = { path, multiplier: 2 };
const answer = { id: "2026-10-21", actual: path, dates: [] };
const states: readonly MatchState[] = [
  { kind: "idle" },
  { kind: "drawing", forecast },
  { kind: "drawn", forecast },
  { kind: "locked", forecast },
  { kind: "revealed", forecast, answer },
  { kind: "answerError", forecast },
];
const events: readonly MatchEvent[] = [
  { type: "drawStart" },
  { type: "drawComplete", path: [1, 2, 3, 4, 5, 6, 7] },
  { type: "drawEnd" },
  { type: "bandChange", multiplier: 3 },
  { type: "lock" },
  { type: "answerLoaded", answer },
  { type: "answerFailed" },
  { type: "retry" },
];
// Columns follow the event order above. Unchanged states reject the event.
const expectedKinds = [
  ["drawing", "drawn", "idle", "idle", "idle", "idle", "idle", "idle"],
  ["drawing", "drawn", "drawn", "drawing", "drawing", "drawing", "drawing", "drawing"],
  ["drawing", "drawn", "drawn", "drawn", "locked", "drawn", "drawn", "drawn"],
  ["locked", "locked", "locked", "locked", "locked", "revealed", "answerError", "locked"],
  ["revealed", "revealed", "revealed", "revealed", "revealed", "revealed", "revealed", "revealed"],
  [
    "answerError",
    "answerError",
    "answerError",
    "answerError",
    "answerError",
    "answerError",
    "answerError",
    "locked",
  ],
];

for (const [stateIndex, state] of states.entries())
  for (const [eventIndex, event] of events.entries())
    test(`${state.kind} accepts or ignores ${event.type}`, () => {
      const before = JSON.stringify(state);
      const next = transition(state, event);
      expect(next.kind).toBe(expectedKinds[stateIndex]?.[eventIndex]);
      expect(JSON.stringify(state)).toBe(before);
      if (next.kind === state.kind && event.type !== "drawComplete" && event.type !== "bandChange")
        expect(next).toBe(state);
    });

test("drawing without a complete forecast cannot lock or change the band", () => {
  const drawing = transition({ kind: "idle" }, { type: "drawStart" });
  for (const event of [
    { type: "drawEnd" },
    { type: "lock" },
    { type: "bandChange", multiplier: 2 },
  ] as const)
    expect(transition(drawing, event)).toBe(drawing);
  expect(transition(drawing, { type: "drawComplete", path })).toEqual({
    kind: "drawn",
    forecast: { path, multiplier: 2 },
  });
});

test.each([
  [1, 2, 3],
  [1, 2, 3, 4, 5, 6, Number.NaN],
  [1, 2, 3, 4, 5, 6, Infinity],
])("rejects incomplete or nonfinite daily values %s", (...values) => {
  const state: MatchState = { kind: "drawing" };
  expect(transition(state, { type: "drawComplete", path: values })).toBe(state);
});

test("a completed edit preserves band width and copies the input path", () => {
  const next = transition({ kind: "drawing", forecast }, { type: "drawComplete", path });
  expect(next).toEqual({ kind: "drawn", forecast });
  if (next.kind !== "drawn") throw new Error("Expected a completed drawing.");
  expect(next.forecast.path).not.toBe(path);
  expect(transition(next, { type: "bandChange", multiplier: 3 })).toEqual({
    kind: "drawn",
    forecast: { path, multiplier: 3 },
  });
  for (const multiplier of [0, -1, Infinity, Number.NaN])
    expect(transition(next, { type: "bandChange", multiplier })).toBe(next);
});

test("failure and retry retain the same locked forecast until an answer arrives", () => {
  const locked = transition({ kind: "drawn", forecast }, { type: "lock" });
  const failed = transition(locked, { type: "answerFailed" });
  expect(failed).toEqual({ kind: "answerError", forecast });
  const retried = transition(failed, { type: "retry" });
  expect(retried).toEqual({ kind: "locked", forecast });
  expect(transition(retried, { type: "answerLoaded", answer })).toEqual({
    kind: "revealed",
    forecast,
    answer,
  });
});
