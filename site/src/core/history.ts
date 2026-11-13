import { isCalendarDate } from "./dates";

const HORIZON = 7;
const SCHEMA_VERSION = 1;
const MAX_CLOSENESS = 100;
const KINDS = ["daily", "live", "custom"] as const;

export type Stats = {
  readonly count: number;
  readonly median: readonly number[];
  readonly p10: readonly number[];
  readonly p90: readonly number[];
  readonly quartiles: readonly number[];
};

export type HistoryPlay = {
  readonly puzzleId: string;
  readonly kind: (typeof KINDS)[number];
  readonly playedOn: string;
  readonly path: readonly number[];
  readonly halfWidth: number;
  readonly closeness: number;
  readonly aiCloseness: number;
  readonly coverage: number;
  readonly stats: Stats | null;
};

function finiteNumbers(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    Array.from(value).every((item: unknown) => typeof item === "number" && Number.isFinite(item))
  );
}

/** Validate crowd statistics from a response or a restored play record. */
export function parseStats(value: unknown): Stats | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  if (
    !("count" in value) ||
    typeof value.count !== "number" ||
    !Number.isInteger(value.count) ||
    value.count < 0 ||
    !("median" in value) ||
    !finiteNumbers(value.median, HORIZON) ||
    !("p10" in value) ||
    !finiteNumbers(value.p10, HORIZON) ||
    !("p90" in value) ||
    !finiteNumbers(value.p90, HORIZON) ||
    !("quartiles" in value) ||
    !finiteNumbers(value.quartiles, 3) ||
    value.quartiles.some(
      (score, index, scores) => score < 0 || score > 100 || score < (scores[index - 1] ?? 0),
    )
  )
    return null;
  return {
    count: value.count,
    median: [...value.median],
    p10: [...value.p10],
    p90: [...value.p90],
    quartiles: [...value.quartiles],
  };
}

function count(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

/**
 * Validate one saved play for a restore file. A bad crowd line only drops the
 * crowd line: losing the whole play over it would also lose the player's streak.
 */
export function parseHistoryRecord(value: unknown): HistoryPlay | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  if (!("schemaVersion" in value) || value.schemaVersion !== SCHEMA_VERSION) return null;
  if (!("puzzleId" in value) || typeof value.puzzleId !== "string" || value.puzzleId === "")
    return null;
  if (!("kind" in value)) return null;
  const kind = KINDS.find((candidate) => candidate === value.kind);
  if (kind === undefined || !("playedOn" in value) || !isCalendarDate(value.playedOn)) return null;
  if (
    !("path" in value) ||
    !Array.isArray(value.path) ||
    value.path.length !== HORIZON ||
    !value.path.every((item: unknown) => typeof item === "number" && Number.isFinite(item))
  )
    return null;
  if (
    !("halfWidth" in value) ||
    typeof value.halfWidth !== "number" ||
    !Number.isFinite(value.halfWidth) ||
    value.halfWidth <= 0
  )
    return null;
  if (
    !("closeness" in value) ||
    !count(value.closeness, MAX_CLOSENESS) ||
    !("aiCloseness" in value) ||
    !count(value.aiCloseness, MAX_CLOSENESS) ||
    !("coverage" in value) ||
    !count(value.coverage, HORIZON)
  )
    return null;
  return {
    puzzleId: value.puzzleId,
    kind,
    playedOn: value.playedOn,
    path: [...value.path],
    halfWidth: value.halfWidth,
    closeness: value.closeness,
    aiCloseness: value.aiCloseness,
    coverage: value.coverage,
    // Missing or malformed statistics restore as no crowd line, not as a lost play.
    stats: "stats" in value ? parseStats(value.stats) : null,
  };
}

/** A whole restore file must be current-schema JSON; one bad record rejects the file. */
export function parseHistory(value: unknown): HistoryPlay[] | null {
  if (!Array.isArray(value)) return null;
  const plays: HistoryPlay[] = [];
  for (const item of value) {
    const play = parseHistoryRecord(item);
    if (play === null) return null;
    plays.push(play);
  }
  return plays;
}

/** Keep the first play of each puzzle; local plays come first, so they win a restore. */
export function mergeHistory(
  local: readonly HistoryPlay[],
  restored: readonly HistoryPlay[],
): HistoryPlay[] {
  const seen = new Set<string>();
  const merged: HistoryPlay[] = [];
  for (const play of [...local, ...restored]) {
    if (seen.has(play.puzzleId)) continue;
    seen.add(play.puzzleId);
    merged.push(play);
  }
  return merged;
}
