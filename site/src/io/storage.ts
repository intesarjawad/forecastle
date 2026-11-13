import { isCalendarDate } from "../core/dates";
import { parseStats, type Stats } from "../core/history";
import { type DailyHistory, recordDailyPlay } from "../core/streak";

const PLAYS_KEY = "forecastle.v1.plays";
const SCHEMA_VERSION = 1;
const HORIZON = 7;
const MAX_CLOSENESS = 100;
const KINDS = ["daily", "live", "custom"] as const;

type StorageAccess = Pick<Storage, "getItem" | "setItem">;

export type Play = {
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

function isCount(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

/** Accept only a current-schema record; anything else reads as absent. */
export function parsePlay(value: unknown): Play | null {
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
    !isCount(value.closeness, MAX_CLOSENESS) ||
    !("aiCloseness" in value) ||
    !isCount(value.aiCloseness, MAX_CLOSENESS) ||
    !("coverage" in value) ||
    !isCount(value.coverage, HORIZON) ||
    !("stats" in value)
  )
    return null;
  const stats = value.stats === null ? null : parseStats(value.stats);
  if (value.stats !== null && stats === null) return null;
  return {
    puzzleId: value.puzzleId,
    kind,
    playedOn: value.playedOn,
    path: [...value.path],
    halfWidth: value.halfWidth,
    closeness: value.closeness,
    aiCloseness: value.aiCloseness,
    coverage: value.coverage,
    stats,
  };
}

/** Daily-streak inputs derived from the saved plays, in play order. */
export function dailyHistory(plays: readonly Play[]): DailyHistory {
  return plays.reduce<DailyHistory>(
    (history, play) => recordDailyPlay(history, play.puzzleId, play.playedOn, play.coverage),
    { playedOn: [], coverages: [] },
  );
}

/**
 * Storage is opened through a callback because merely touching `localStorage` throws in some
 * private modes. Blocked access and corrupt contents both leave the game playable.
 */
export function createPlayStore(open: () => StorageAccess) {
  function read(): { plays: Play[]; blocked: boolean } {
    let raw: string | null;
    try {
      raw = open().getItem(PLAYS_KEY);
    } catch {
      return { plays: [], blocked: true };
    }
    if (raw === null) return { plays: [], blocked: false };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { plays: [], blocked: false };
    }
    if (!Array.isArray(parsed)) return { plays: [], blocked: false };
    const plays: Play[] = [];
    for (const item of parsed) {
      const play = parsePlay(item);
      if (play !== null && !plays.some((saved) => saved.puzzleId === play.puzzleId))
        plays.push(play);
    }
    return { plays, blocked: false };
  }

  function write(plays: readonly Play[]): boolean {
    try {
      open().setItem(
        PLAYS_KEY,
        JSON.stringify(plays.map((item) => ({ ...item, schemaVersion: SCHEMA_VERSION }))),
      );
      return true;
    } catch {
      return false;
    }
  }

  return {
    read,
    /** The first result for a puzzle stands. Returns false when the browser would not save it. */
    save(play: Play): boolean {
      const { plays, blocked } = read();
      if (blocked) return false;
      if (plays.some((saved) => saved.puzzleId === play.puzzleId)) return true;
      return write([...plays, play]);
    },
    /** Crowd stats can arrive after the play is saved; keep them without changing its result. */
    saveStats(puzzleId: string, stats: Stats | null): boolean {
      const { plays, blocked } = read();
      if (blocked || !plays.some((saved) => saved.puzzleId === puzzleId)) return false;
      return write(plays.map((play) => (play.puzzleId === puzzleId ? { ...play, stats } : play)));
    },
  };
}

const LIVE_KEY = "forecastle.v1.live";
const MAX_LOCK_MS = 3_600_000;
const LIVE_STATUSES = ["sent", "unsent", "kept", "unserved"] as const;

/**
 * A locked live entry, kept apart from scored plays because its score does not exist until the
 * round resolves. `sent` means the Worker holds it; `kept` (crowd switch off) and `unserved`
 * (no Worker configured) mean it never left the device.
 */
export type LiveEntryRecord = {
  readonly puzzleId: string;
  readonly path: readonly number[];
  readonly halfWidth: number;
  readonly msToLock: number;
  readonly status: (typeof LIVE_STATUSES)[number];
};

export function parseLiveEntry(value: unknown): LiveEntryRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  if (!("schemaVersion" in value) || value.schemaVersion !== SCHEMA_VERSION) return null;
  if (!("puzzleId" in value) || typeof value.puzzleId !== "string" || value.puzzleId === "")
    return null;
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
    value.halfWidth <= 0 ||
    !("msToLock" in value) ||
    !isCount(value.msToLock, MAX_LOCK_MS) ||
    !("status" in value)
  )
    return null;
  const status = LIVE_STATUSES.find((candidate) => candidate === value.status);
  if (status === undefined) return null;
  return {
    puzzleId: value.puzzleId,
    path: [...value.path],
    halfWidth: value.halfWidth,
    msToLock: value.msToLock,
    status,
  };
}

/** One entry per live chart on this device; blocked or damaged storage reads as no entries. */
export function createLiveEntryStore(open: () => StorageAccess) {
  function read(): LiveEntryRecord[] {
    try {
      const parsed: unknown = JSON.parse(open().getItem(LIVE_KEY) ?? "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((item) => parseLiveEntry(item) ?? []);
    } catch {
      return [];
    }
  }

  function write(entries: readonly LiveEntryRecord[]): boolean {
    try {
      open().setItem(
        LIVE_KEY,
        JSON.stringify(entries.map((item) => ({ ...item, schemaVersion: SCHEMA_VERSION }))),
      );
      return true;
    } catch {
      return false;
    }
  }

  return {
    read,
    find(puzzleId: string): LiveEntryRecord | undefined {
      return read().find((entry) => entry.puzzleId === puzzleId);
    },
    /** The first entry for a chart stands. Returns false when the browser would not save it. */
    save(entry: LiveEntryRecord): boolean {
      const entries = read();
      if (entries.some((saved) => saved.puzzleId === entry.puzzleId)) return true;
      return write([...entries, entry]);
    },
    setStatus(puzzleId: string, status: LiveEntryRecord["status"]): boolean {
      return write(
        read().map((entry) => (entry.puzzleId === puzzleId ? { ...entry, status } : entry)),
      );
    },
  };
}
