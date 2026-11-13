import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import liveForecast from "../../../benchmark/fixtures/live/fixture/1/forecast.json" with {
  type: "json",
};
import livePuzzle1 from "../../../benchmark/fixtures/live/fixture/1/puzzle.json" with {
  type: "json",
};
import livePuzzle2 from "../../../benchmark/fixtures/live/fixture/2/puzzle.json" with {
  type: "json",
};
import livePuzzle3 from "../../../benchmark/fixtures/live/fixture/3/puzzle.json" with {
  type: "json",
};
import game from "../../../data/game.json" with { type: "json" };
import { puzzle } from "./recorded-play";

export const customPayload = readFileSync(
  new URL("../fixtures/custom-payload.txt", import.meta.url),
  "utf8",
).trim();

const livePuzzles = [livePuzzle1, livePuzzle2, livePuzzle3];
const liveEntry = {
  id: "live-2026-11-09",
  charts: 3,
  opensUtc: "2026-11-09T00:05:00+00:00",
  cutoffUtc: "2026-11-10T23:59:59+00:00",
  resolvesUtc: "2026-11-18T06:00:00+00:00",
  resolved: false,
};
const liveStates = {
  pending: {
    ...liveEntry,
    cutoffUtc: "2026-11-21T23:59:59+00:00",
    resolvesUtc: "2026-11-29T06:00:00+00:00",
  },
  awaiting: liveEntry,
  resolved: { ...liveEntry, resolved: true },
} as const;

export function indexJson(live: readonly object[]) {
  return {
    launchDate: game.launchDate,
    puzzles: [{ id: puzzle.id, number: puzzle.number, kind: "historical", label: puzzle.label }],
    live,
  };
}

export async function mockIndex(page: Page, body: unknown) {
  await page.route("**/puzzles/index.json", (route) => route.fulfill({ json: body }));
}

async function failIndex(page: Page) {
  await page.route("**/puzzles/index.json", (route) => route.fulfill({ status: 500, body: "" }));
}

export async function mockLive(page: Page, state: keyof typeof liveStates) {
  await mockIndex(page, indexJson([liveStates[state]]));
  const chart = (url: string) => {
    const number = Number(new URL(url).pathname.split("/").at(-2));
    const found = livePuzzles.find((candidate) => candidate.number === number);
    if (!found) throw new Error(`No live fixture for chart ${number}.`);
    return found;
  };
  await page.route("**/live/live-2026-11-09/*/puzzle.json", (route) =>
    route.fulfill({ json: chart(route.request().url()) }),
  );
  await page.route("**/live/live-2026-11-09/*/forecast.json", (route) =>
    route.fulfill({ json: liveForecast }),
  );
  await page.route("**/live/live-2026-11-09/*/answer.json", (route) => {
    const found = chart(route.request().url());
    return route.fulfill({
      json: {
        id: found.id,
        dates: found.scoredDates,
        actual: [28, 29, 30, 31, 32, 33, 34],
        crowd: {
          count: 10,
          median: [5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5],
          p10: [1.9, 2.9, 3.9, 4.9, 5.9, 6.9, 7.9],
          p90: [9.1, 10.1, 11.1, 12.1, 13.1, 14.1, 15.1],
        },
      },
    });
  });
}

async function seedPlays(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "forecastle.v1.plays",
      JSON.stringify([
        {
          schemaVersion: 1,
          puzzleId: "2026-11-19",
          kind: "daily",
          playedOn: "2026-11-19",
          path: [1, 2, 3, 4, 5, 6, 7],
          halfWidth: 1,
          closeness: 61,
          aiCloseness: 48,
          coverage: 5,
          stats: null,
        },
      ]),
    );
  });
}

type RouteCase = {
  readonly name: string;
  readonly hash: string;
  readonly setup?: (page: Page) => Promise<void>;
  readonly ready: (page: Page) => Locator;
  readonly count?: number;
};

/** Pages outside the daily match, each with the setup that renders it. */
export const routeCases: readonly RouteCase[] = [
  {
    name: "the archive",
    hash: "#/archive",
    ready: (page) => page.locator(".archive-list a"),
  },
  {
    name: "an empty archive",
    hash: "#/archive",
    setup: (page) => mockIndex(page, { ...indexJson([]), puzzles: [] }),
    ready: (page) => page.getByText("No daily puzzles are published yet."),
  },
  {
    name: "an archive that failed to load",
    hash: "#/archive",
    setup: failIndex,
    ready: (page) => page.getByText("The archive did not load."),
  },
  {
    name: "an archived puzzle",
    hash: `#/p/${game.launchDate}`,
    ready: (page) => page.getByRole("slider"),
    count: 7,
  },
  {
    name: "an archived puzzle that is not published",
    hash: "#/p/2026-11-21",
    ready: (page) => page.getByText("That puzzle is not published."),
  },
  {
    name: "how scoring works",
    hash: "#/how",
    ready: (page) => page.getByRole("heading", { name: "Closeness" }),
  },
  {
    name: "an empty data page",
    hash: "#/data",
    ready: (page) => page.getByText("No plays are saved on this device yet."),
  },
  {
    name: "a data page with a saved play",
    hash: "#/data",
    setup: seedPlays,
    ready: (page) => page.locator(".history-list li"),
  },
  {
    name: "an unknown page",
    hash: "#/nowhere",
    ready: (page) => page.getByText("That page does not exist."),
  },
  {
    name: "no live round",
    hash: "#/live",
    ready: (page) => page.getByText("No live round is open yet."),
  },
  {
    name: "a live round that failed to load",
    hash: "#/live",
    setup: failIndex,
    ready: (page) => page.getByText("The live round did not load."),
  },
  {
    name: "a live round before its cutoff",
    hash: "#/live",
    setup: (page) => mockLive(page, "pending"),
    ready: (page) => page.locator(".live-lock"),
    count: 3,
  },
  {
    name: "a live round awaiting its record",
    hash: "#/live",
    setup: (page) => mockLive(page, "awaiting"),
    ready: (page) => page.locator(".chart-machine"),
    count: 3,
  },
  {
    name: "a resolved live round",
    hash: "#/live",
    setup: (page) => mockLive(page, "resolved"),
    ready: (page) => page.locator(".chart-reality"),
    count: 3,
  },
  {
    name: "a custom link",
    hash: `#/c/${customPayload}`,
    ready: (page) => page.locator("#series-name"),
  },
  {
    name: "a damaged custom link",
    hash: `#/c/${customPayload.slice(0, -40)}`,
    ready: (page) => page.getByText("That custom link is damaged. Ask the sender for a new one."),
  },
];
