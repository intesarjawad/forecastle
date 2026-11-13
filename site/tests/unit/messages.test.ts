import { expect, test } from "vitest";
import { type Message, messages } from "../../src/ui/messages";

const EXPECTED = [
  {
    key: "pageFailed",
    kind: "error",
    what: "This page did not load. Reload to try again.",
    label: "Reload page",
  },
  {
    key: "storageBlocked",
    kind: "error",
    what: "This browser is not saving data, so your streak will not be kept.",
    label: "Play anyway",
  },
  {
    key: "puzzleMissing",
    kind: "error",
    what: "Today's puzzle is not published yet.",
    label: "Play the latest puzzle",
  },
  {
    key: "answerFailed",
    kind: "error",
    what: "The answer did not load. Your drawing is kept.",
    label: "Try again",
  },
  {
    key: "answerLoading",
    kind: "notice",
    what: "Loading the answer.",
    label: null,
  },
] as const;

type Expected = (typeof EXPECTED)[number];

const PAGE_KEYS = ["nav", "archive", "live", "how", "custom", "data", "missing"] as const;

function message({ key }: Expected, run: () => void = () => {}): Message {
  switch (key) {
    case "pageFailed":
      return messages.pageFailed(run);
    case "storageBlocked":
      return messages.storageBlocked(run);
    case "puzzleMissing":
      return messages.puzzleMissing(run);
    case "answerFailed":
      return messages.answerFailed(run);
    case "answerLoading":
      return messages.answerLoading;
  }
}

test("the table holds exactly the states the pages report", () => {
  expect(Object.keys(messages).sort()).toEqual(
    [...EXPECTED.map(({ key }) => key), ...PAGE_KEYS].sort(),
  );
});

test.each(EXPECTED)("$key uses its contract kind", (expected) => {
  expect(message(expected).kind).toBe(expected.kind);
});

test.each(EXPECTED)("$key keeps its text and ends it with a full stop", (expected) => {
  const { what } = message(expected);
  expect(what).toBe(expected.what);
  expect(what.endsWith(".")).toBe(true);
});

test.each(EXPECTED)("$key gives every error a labelled action and notices none", (expected) => {
  const actual = message(expected);
  if (actual.kind === "notice") {
    expect(actual).not.toHaveProperty("action");
    return;
  }
  expect(actual.action.label).toBe(expected.label);
  expect(actual.action.label.trim()).not.toBe("");
});

test.each(EXPECTED.filter(({ kind }) => kind === "error"))(
  "$key runs the action the caller supplies",
  (expected) => {
    let runs = 0;
    const actual = message(expected, () => {
      runs += 1;
    });
    if (actual.kind !== "error") throw new Error("Expected an error message.");
    void actual.action.run();
    expect(runs).toBe(1);
  },
);

test("the page copy names every route and the live states", () => {
  expect(messages.nav.archive).toBe("Archive");
  expect(messages.nav.live).toBe("Live");
  expect(messages.nav.data).toBe("Your data");
  expect(messages.archive.title).toBe("Archive");
  expect(messages.live.title).toBe("Live");
  expect(messages.how.title).toBe("How scoring works");
  expect(messages.data.title).toBe("Your data");
  expect(messages.missing.title).toBe("Page not found");
  expect(messages.custom.title).toBe("Custom puzzle, made by whoever sent you this link");
  for (const state of [messages.live.pending, messages.live.awaiting, messages.live.resolved]) {
    expect(state.endsWith(".")).toBe(true);
  }
  expect(messages.live.gap(3)).toBe("3 unscored gap days");
  expect(messages.live.gap(1)).toBe("1 unscored gap day");
  expect(messages.data.restored(1)).toBe("Restored 1 play.");
  expect(messages.data.restored(2)).toBe("Restored 2 plays.");
  expect(messages.data.restored(0, 1)).toBe("Restored 0 plays and 1 live entry.");
  expect(messages.data.restored(1, 3)).toBe("Restored 1 play and 3 live entries.");
});

test("live dates and archive links keep their data in the copy", () => {
  expect(messages.live.badge("1 Nov 2026", "2 Nov 2026")).toBe(
    "Closes 1 Nov 2026. Resolves 2 Nov 2026.",
  );
  expect(messages.archive.entry(4, "Temperature", "2026-11-23")).toBe(
    "#4: Temperature, 2026-11-23",
  );
});
