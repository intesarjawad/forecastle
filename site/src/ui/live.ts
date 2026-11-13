import type { LivePuzzle } from "../io/live";
import { parseLiveAnswer, parseLiveForecast, parseLivePuzzle } from "../io/live";
import type { LiveCard, LiveOptions } from "./live-card";
import { paintLiveCard as paint } from "./live-chart";
import { createLiveEntries } from "./live-entry";
import { formatInstant, hashPrefix, type LiveState, liveBadge, liveState } from "./live-time";
import { messages } from "./messages";
import { messagePanel as panel, paragraph } from "./page";

export {
  type LiveAnswer,
  type LiveCrowd,
  type LiveEntry,
  type LiveForecast,
  type LiveGeometry,
  type LivePuzzle,
  type LiveTableRow,
  parseLiveAnswer,
  parseLiveForecast,
  parseLivePuzzle,
} from "../io/live";
export { futureSlotX, liveGapBox, livePath, liveTableRows } from "./live-chart";
export { type EntryNote, entryOutcome } from "./live-entry";
export { hashPrefix, type LiveState, liveBadge, liveState } from "./live-time";

function link(href: string, value: string): HTMLAnchorElement {
  const element = document.createElement("a");
  element.href = href;
  element.textContent = value;
  return element;
}

/**
 * The live page reads only published files: the sealed round before the cutoff,
 * then the forecast and answer after it. Its one Worker request is the player's own entry.
 */
export function renderLive(root: HTMLElement, options: LiveOptions): () => void {
  const { entry, transport, baseUrl } = options;
  const instant = (value: string) => formatInstant(value, options.locale, options.timeZone);
  root.replaceChildren();
  root.append(paragraph("live-intro", messages.live.intro));
  const badge = paragraph("live-badge", liveBadge(entry, options.locale, options.timeZone));
  const cards = document.createElement("div");
  cards.className = "live-cards";
  root.append(badge);
  if (liveState(entry, options.now()) === "awaiting")
    root.append(
      panel(
        messages.live.closed(
          instant(entry.cutoffUtc),
          instant(entry.resolvesUtc),
          options.playToday,
        ),
      ),
    );
  root.append(cards);

  const cleanups: Array<() => void> = [];
  let closed = false;
  const { startEntry, showSaved } = createLiveEntries(options, () => closed, paint);

  const createCard = (number: number): LiveCard => {
    const element = document.createElement("article");
    element.className = "live-card";
    element.dataset.state = "loading";
    const title = document.createElement("h2");
    title.className = "live-title";
    title.textContent = messages.live.chart(number);
    const status = paragraph("live-status", messages.live.loading);
    status.setAttribute("role", "status");
    const chartSlot = document.createElement("div");
    chartSlot.className = "chart live-chart";
    const gapNote = paragraph("live-gap-note", "");
    const provenance = document.createElement("div");
    provenance.className = "live-provenance";
    const legend = document.createElement("ul");
    legend.className = "live-legend";
    for (const label of [
      messages.live.legend.ai,
      messages.live.legend.crowd,
      messages.live.legend.actual,
    ]) {
      const item = document.createElement("li");
      item.textContent = label;
      legend.append(item);
    }
    const table = document.createElement("div");
    const controls = document.createElement("div");
    controls.className = "controls live-controls";
    const note = document.createElement("div");
    note.className = "live-note";
    note.setAttribute("aria-live", "polite");
    note.tabIndex = -1;
    element.append(title, status, chartSlot, controls, note, gapNote, legend, provenance, table);
    cards.append(element);
    const card: LiveCard = {
      number,
      element,
      chartSlot,
      status,
      gapNote,
      provenance,
      table,
      title,
      controls,
      note,
      state: "pending",
      match: { kind: "idle" },
    };
    const observer = new ResizeObserver(() => paint(card));
    observer.observe(chartSlot);
    cleanups.push(() => observer.disconnect());
    return card;
  };

  const setState = (card: LiveCard, state: LiveState, puzzle: LivePuzzle) => {
    card.state = state;
    card.element.dataset.state = state;
    card.title.textContent = messages.live.chartTitle(puzzle.number, puzzle.label);
    card.status.textContent =
      state === "pending"
        ? messages.live.pending
        : state === "awaiting"
          ? messages.live.awaiting
          : messages.live.resolved;
    card.gapNote.textContent = puzzle.gapDays > 0 ? messages.live.gapNote(puzzle.gapDays) : "";
    card.provenance.replaceChildren();
    const where = `${baseUrl}live/${entry.id}/${card.number}`;
    if (state === "pending")
      card.provenance.append(
        paragraph(
          "live-lock",
          messages.live.lock(formatInstant(puzzle.cutoffUtc, options.locale, options.timeZone)),
        ),
      );
    const commit = document.createElement("p");
    commit.className = "live-commit";
    commit.append(messages.live.commit, " ");
    const hash = link(`${where}/puzzle.json`, hashPrefix(puzzle.forecastSha256));
    commit.append(hash, " ");
    commit.append(link(`${where}/forecast.json.ots`, messages.live.proof));
    card.provenance.append(commit);
    paint(card);
  };

  const read = async <T>(url: string, parse: (value: unknown) => T): Promise<T> => {
    const response = await transport(url);
    if (!response.ok) throw new Error(`Live request failed (${response.status}).`);
    return parse(await response.json());
  };

  const load = async (card: LiveCard) => {
    const where = `${baseUrl}live/${entry.id}/${card.number}`;
    let failure: string = messages.live.chartFailed;
    try {
      const puzzle = await read(`${where}/puzzle.json`, parseLivePuzzle);
      if (closed) return;
      if (puzzle.number !== card.number) throw new Error("Chart number does not match its URL.");
      card.puzzle = puzzle;
      const saved = options.entries.find(puzzle.id);
      if (saved) card.saved = saved;
      const state = liveState(entry, options.now());
      if (state !== "pending") {
        failure = messages.live.forecastFailed;
        card.forecast = await read(`${where}/forecast.json`, parseLiveForecast);
        if (closed) return;
        if (state === "resolved") {
          failure = messages.live.recordFailed;
          card.answer = await read(`${where}/answer.json`, (value) =>
            parseLiveAnswer(value, puzzle.id),
          );
          if (closed) return;
        }
      }
      setState(card, state, puzzle);
      if (state === "pending" && !card.saved) {
        const stop = startEntry(card, puzzle);
        if (stop) cleanups.push(stop);
      } else showSaved(card, puzzle);
    } catch {
      if (closed) return;
      card.element.dataset.state = "failed";
      card.status.textContent = failure;
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "key-button";
      retry.textContent = "Retry chart";
      retry.addEventListener("click", () => {
        retry.remove();
        card.element.dataset.state = "loading";
        card.status.textContent = messages.live.loading;
        void load(card);
      });
      card.status.after(retry);
    }
  };

  for (let number = 1; number <= entry.charts; number += 1) void load(createCard(number));

  return () => {
    closed = true;
    for (const cleanup of cleanups) cleanup();
  };
}
