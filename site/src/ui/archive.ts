import { isCalendarDate } from "../core/dates";
import { type Puzzle, type PuzzleIndex, parsePuzzle } from "../io/puzzle-validation";
import { messages } from "./messages";

const LIVE_PREFIX = "live-";

export type Route =
  | { readonly kind: "today" }
  | { readonly kind: "archive" }
  | { readonly kind: "puzzle"; readonly id: string }
  | { readonly kind: "live"; readonly id?: string }
  | { readonly kind: "how" }
  | { readonly kind: "unknown" };

/**
 * The hash is the whole route table, so a copied link opens the same page.
 * Anything that does not match a known page stays explicit instead of
 * falling back to today's puzzle.
 */
export function parseRoute(hash: string): Route {
  const path = hash.startsWith("#/") ? hash.slice(2) : hash.replace(/^#/u, "");
  if (path === "") return { kind: "today" };
  if (path === "archive") return { kind: "archive" };
  if (path === "live") return { kind: "live" };
  if (path === "how") return { kind: "how" };
  if (path.startsWith("p/")) {
    const id = path.slice(2);
    if (isCalendarDate(id)) return { kind: "puzzle", id };
  }
  if (path.startsWith(`live/${LIVE_PREFIX}`)) {
    const id = path.slice("live/".length);
    if (isCalendarDate(id.slice(LIVE_PREFIX.length))) return { kind: "live", id };
  }
  return { kind: "unknown" };
}

export type ArchiveEntry = {
  readonly id: string;
  readonly href: string;
  readonly text: string;
};

/** Newest first; the index's own order is not part of its validation. */
export function archiveEntries(index: PuzzleIndex): ArchiveEntry[] {
  return [...index.puzzles]
    .sort((left, right) => {
      if (left.id < right.id) return 1;
      if (left.id > right.id) return -1;
      return 0;
    })
    .map((puzzle) => ({
      id: puzzle.id,
      href: `#/p/${puzzle.id}`,
      text: messages.archive.entry(puzzle.number, puzzle.label, puzzle.id),
    }));
}

/** Every other live round, newest first, so a resolved round stays reachable after the next opens. */
export function otherLiveRounds(index: PuzzleIndex, shownId: string): ArchiveEntry[] {
  return index.live
    .filter((round) => round.id !== shownId)
    .sort((left, right) => (left.id < right.id ? 1 : left.id > right.id ? -1 : 0))
    .map((round) => ({
      id: round.id,
      href: `#/live/${round.id}`,
      text: messages.live.roundEntry(round.id.slice(LIVE_PREFIX.length), round.resolved),
    }));
}

/** List the other live rounds under the one on screen; nothing when there are none. */
export function renderOtherLiveRounds(
  root: HTMLElement,
  index: PuzzleIndex,
  shownId: string,
): void {
  const entries = otherLiveRounds(index, shownId);
  if (entries.length === 0) return;
  const section = document.createElement("section");
  section.className = "archive";
  const heading = document.createElement("h2");
  heading.textContent = messages.live.otherRounds;
  const list = document.createElement("ul");
  list.className = "archive-list";
  for (const entry of entries) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = entry.href;
    link.textContent = entry.text;
    item.append(link);
    list.append(item);
  }
  section.append(heading, list);
  root.append(section);
}

/** Read one published daily puzzle for replay outside its launch day. */
export async function loadArchivePuzzle(
  id: string,
  transport: (url: string) => Promise<Response> = (url) => fetch(url),
  baseUrl = import.meta.env.BASE_URL,
): Promise<Puzzle> {
  const response = await transport(`${baseUrl}puzzles/${id}/puzzle.json`);
  if (!response.ok) throw new Error(`Puzzle request failed (${response.status}).`);
  const puzzle = parsePuzzle(await response.json());
  if (puzzle.id !== id) throw new Error("Puzzle id does not match its URL.");
  return puzzle;
}

/** Render the archive's links without letting a puzzle label become markup. */
export function renderArchive(root: HTMLElement, index: PuzzleIndex): void {
  const section = document.createElement("section");
  section.className = "archive";
  const intro = document.createElement("p");
  intro.textContent = messages.archive.intro;
  section.append(intro);
  const entries = archiveEntries(index);
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = messages.archive.empty;
    section.append(empty);
  } else {
    const list = document.createElement("ul");
    list.className = "archive-list";
    for (const entry of entries) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = entry.href;
      link.textContent = entry.text;
      item.append(link);
      list.append(item);
    }
    section.append(list);
  }
  root.replaceChildren(section);
}
