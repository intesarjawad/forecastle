import type { MatchState } from "../core/state";
import type { LiveAnswer, LiveEntry, LiveForecast, LivePuzzle } from "../io/live";
import type { LiveEntryRecord } from "../io/storage";
import type { CrowdResult } from "../io/submissions";
import type { createDrawing } from "./draw";
import type { LiveState } from "./live-time";
import type { MessageRun } from "./messages";

type EntryForecast = Pick<LiveEntryRecord, "path" | "halfWidth" | "msToLock">;

export type LiveOptions = {
  readonly entry: LiveEntry;
  readonly transport: (url: string) => Promise<Response>;
  readonly baseUrl: string;
  readonly now: () => number;
  /** Locked entries on this device, one per chart. */
  readonly entries: {
    readonly find: (puzzleId: string) => LiveEntryRecord | undefined;
    readonly save: (entry: LiveEntryRecord) => boolean;
    readonly setStatus: (puzzleId: string, status: LiveEntryRecord["status"]) => boolean;
  };
  /** Posts one entry; never sampled, and the result arrives once. */
  readonly send: (
    puzzleId: string,
    forecast: EntryForecast,
    onResult: (result: CrowdResult) => void,
  ) => void;
  readonly playToday: MessageRun;
  readonly locale?: string;
  readonly timeZone?: string;
};

export type LiveCard = {
  readonly number: number;
  readonly element: HTMLElement;
  readonly chartSlot: HTMLElement;
  readonly status: HTMLElement;
  readonly gapNote: HTMLElement;
  readonly provenance: HTMLElement;
  readonly table: HTMLElement;
  readonly title: HTMLElement;
  readonly controls: HTMLElement;
  readonly note: HTMLElement;
  paintKey?: string;
  state: LiveState;
  match: MatchState;
  drawing?: ReturnType<typeof createDrawing>;
  saved?: LiveEntryRecord;
  puzzle?: LivePuzzle;
  forecast?: LiveForecast;
  answer?: LiveAnswer;
};
