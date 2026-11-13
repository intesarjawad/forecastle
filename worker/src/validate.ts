export const HORIZON = 7;
const DAY_MS = 86_400_000;
const MAX_LOCK_MS = 3_600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Submission {
  puzzleId: string;
  clientId: string;
  path: number[];
  halfWidth: number;
  msToLock: number;
}

export interface Puzzle {
  yDomain: number[];
  typicalMove: number;
  cutoffUtc?: string;
  resolvesUtc?: string;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function finiteArray(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((item: unknown) => typeof item === "number" && Number.isFinite(item))
  );
}

export function validPuzzleId(id: string): boolean {
  if (!/^(?:\d{4}-\d{2}-\d{2}|live-\d{4}-\d{2}-\d{2}-[1-3])$/.test(id)) return false;
  const date = id.startsWith("live-") ? id.slice(5, 15) : id;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === date;
}

export function parseSubmission(value: unknown, now: number): Submission | null {
  if (
    !isObject(value) ||
    typeof value.puzzleId !== "string" ||
    !validPuzzleId(value.puzzleId) ||
    typeof value.clientId !== "string" ||
    !UUID.test(value.clientId) ||
    !finiteArray(value.path, HORIZON) ||
    typeof value.halfWidth !== "number" ||
    !Number.isFinite(value.halfWidth) ||
    typeof value.msToLock !== "number" ||
    !Number.isInteger(value.msToLock) ||
    value.msToLock < 0 ||
    value.msToLock > MAX_LOCK_MS
  )
    return null;
  if (!value.puzzleId.startsWith("live-")) {
    const today = Math.floor(now / DAY_MS) * DAY_MS;
    if (Math.abs(Date.parse(`${value.puzzleId}T00:00:00Z`) - today) > DAY_MS) return null;
  }
  return {
    puzzleId: value.puzzleId,
    clientId: value.clientId.toLowerCase(),
    path: value.path,
    halfWidth: value.halfWidth,
    msToLock: value.msToLock,
  };
}

export function parsePuzzle(value: unknown, id: string): Puzzle | null {
  if (
    !isObject(value) ||
    value.id !== id ||
    !finiteArray(value.yDomain, 2) ||
    (value.yDomain[0] ?? Infinity) >= (value.yDomain[1] ?? -Infinity) ||
    typeof value.typicalMove !== "number" ||
    !Number.isFinite(value.typicalMove) ||
    value.typicalMove <= 0
  )
    return null;
  if (id.startsWith("live-")) {
    if (
      typeof value.cutoffUtc !== "string" ||
      typeof value.resolvesUtc !== "string" ||
      !Number.isFinite(Date.parse(value.cutoffUtc)) ||
      !Number.isFinite(Date.parse(value.resolvesUtc)) ||
      Date.parse(value.cutoffUtc) >= Date.parse(value.resolvesUtc)
    )
      return null;
    return {
      yDomain: value.yDomain,
      typicalMove: value.typicalMove,
      cutoffUtc: value.cutoffUtc,
      resolvesUtc: value.resolvesUtc,
    };
  }
  return { yDomain: value.yDomain, typicalMove: value.typicalMove };
}

export function fitsPuzzle(submission: Submission, puzzle: Puzzle): boolean {
  return (
    submission.path.every(
      (value) =>
        value >= (puzzle.yDomain[0] ?? Infinity) && value <= (puzzle.yDomain[1] ?? -Infinity),
    ) &&
    submission.halfWidth >= 0.25 * puzzle.typicalMove &&
    submission.halfWidth <= 8 * puzzle.typicalMove
  );
}
