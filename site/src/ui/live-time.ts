import type { LiveEntry } from "../io/live";
import { messages } from "./messages";

export type LiveState = "pending" | "awaiting" | "resolved";
const HASH_PREFIX_LENGTH = 12;

/** The round's own resolution flag decides the resolved page; the clock only splits the wait. */
export function liveState(entry: LiveEntry, nowMs: number): LiveState {
  if (entry.resolved) return "resolved";
  return nowMs < Date.parse(entry.cutoffUtc) ? "pending" : "awaiting";
}

/** The full digest is verified in the files; the short form is what a reader can compare. */
export function hashPrefix(value: string): string {
  return value.slice(0, HASH_PREFIX_LENGTH);
}

export function formatInstant(value: string, locale?: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone === undefined ? {} : { timeZone }),
  }).format(new Date(value));
}

/** Close and resolve times use the viewer's own locale and time zone. */
export function liveBadge(entry: LiveEntry, locale?: string, timeZone?: string): string {
  return messages.live.badge(
    formatInstant(entry.cutoffUtc, locale, timeZone),
    formatInstant(entry.resolvesUtc, locale, timeZone),
  );
}
