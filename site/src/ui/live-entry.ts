import { DEFAULT_BAND_MULTIPLIER, transition } from "../core/state";
import { verdict } from "../core/verdict";
import type { LivePuzzle } from "../io/live";
import type { LiveEntryRecord } from "../io/storage";
import type { CrowdResult } from "../io/submissions";
import { createBandControl } from "./band";
import { createDrawing } from "./draw";
import type { LiveCard, LiveOptions } from "./live-card";
import { formatInstant, liveState } from "./live-time";
import { type Message, messages } from "./messages";
import { messagePanel as panel, paragraph } from "./page";
import { scoreMatch } from "./reveal";

const MAX_LOCK_MS = 3_600_000;

export type EntryNote =
  | "entered"
  | "duplicate"
  | "kept"
  | "unserved"
  | "closed"
  | "offline"
  | "busy";

/**
 * What a send outcome means for the stored entry and for the player. Only the Worker can say
 * the round is closed; a failed request is "offline" only when the browser itself says so.
 */
export function entryOutcome(
  result: CrowdResult,
  online: boolean,
): { readonly status: LiveEntryRecord["status"]; readonly note: EntryNote } | null {
  switch (result.kind) {
    case "entered":
    case "duplicate":
      return { status: "sent", note: result.kind };
    case "kept":
      return { status: "kept", note: "kept" };
    case "skipped":
      return { status: "unserved", note: "unserved" };
    case "closed":
    case "busy":
      return { status: "unsent", note: result.kind };
    case "unavailable":
      return { status: "unsent", note: online ? "busy" : "offline" };
    default:
      return null;
  }
}

export function createLiveEntries(
  options: LiveOptions,
  isClosed: () => boolean,
  paint: (card: LiveCard) => void,
) {
  const entry = options.entry;
  const instant = (value: string) => formatInstant(value, options.locale, options.timeZone);
  const showNote = (card: LiveCard, ...copies: Message[]) => {
    card.note.replaceChildren(...copies.map(panel));
  };

  const noteFor = (card: LiveCard, puzzle: LivePuzzle, note: EntryNote): Message => {
    const resolves = instant(puzzle.resolvesUtc);
    switch (note) {
      case "entered":
        return messages.live.entered(instant(puzzle.opensUtc), resolves);
      case "duplicate":
        return messages.live.duplicate(resolves);
      case "kept":
        return messages.live.kept;
      case "unserved":
        return messages.live.unserved;
      case "closed":
        return messages.live.closed(instant(puzzle.cutoffUtc), resolves, options.playToday);
      case "offline":
        return messages.live.offline(() => send(card, puzzle));
      case "busy":
        return messages.live.busy(() => send(card, puzzle));
    }
  };

  /** The stored status follows the Worker's answer even if the page is gone by then. */
  const send = (card: LiveCard, puzzle: LivePuzzle) => {
    const saved = card.saved;
    if (!saved) return;
    showNote(card, { kind: "notice", what: messages.live.sending });
    const { path, halfWidth, msToLock } = saved;
    options.send(saved.puzzleId, { path, halfWidth, msToLock }, (result) => {
      const outcome = entryOutcome(result, navigator.onLine);
      if (!outcome) return;
      card.saved = { ...saved, status: outcome.status };
      const persist = () => {
        const savedStatus = options.entries.setStatus(saved.puzzleId, outcome.status);
        if (isClosed()) return;
        showNote(
          card,
          noteFor(card, puzzle, outcome.note),
          ...(savedStatus
            ? []
            : [
                {
                  kind: "error" as const,
                  what: "The entry status could not be saved on this device. Keep this page open and retry saving.",
                  action: { label: "Retry save", run: persist },
                },
              ]),
        );
      };
      persist();
    });
  };

  /** The daily puzzle's drawing, band and state machine, with the pen starting after the gap. */
  const startEntry = (card: LiveCard, puzzle: LivePuzzle) => {
    const start = puzzle.visible.at(-1);
    if (start === undefined) return;
    const shownAt = performance.now();
    let drawStartedAt: number | undefined;
    let band: HTMLElement | undefined;
    const lock = document.createElement("button");
    lock.type = "button";
    lock.className = "lock-button";
    lock.textContent = "Lock";
    lock.disabled = true;
    card.controls.replaceChildren(lock);
    card.note.replaceChildren(paragraph("live-draw", messages.live.draw));
    const updateLock = () => {
      lock.disabled = card.match.kind !== "drawn";
    };
    const startDrawing = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      drawStartedAt ??= performance.now();
      card.match = transition(card.match, { type: "drawStart" });
      updateLock();
    };
    const endDrawing = () => {
      card.match = transition(card.match, { type: "drawEnd" });
      updateLock();
      requestAnimationFrame(() => {
        if (!isClosed()) paint(card);
      });
    };
    card.chartSlot.addEventListener("pointerdown", startDrawing, true);
    card.chartSlot.addEventListener("pointerup", endDrawing);
    card.chartSlot.addEventListener("pointercancel", endDrawing);
    const drawing = createDrawing(
      {
        start,
        yDomain: puzzle.yDomain,
        typicalMove: puzzle.typicalMove,
        unit: puzzle.unit,
        guidance: card.controls,
        halfWidth: () =>
          ("forecast" in card.match
            ? (card.match.forecast?.multiplier ?? DEFAULT_BAND_MULTIPLIER)
            : DEFAULT_BAND_MULTIPLIER) * puzzle.typicalMove,
      },
      (values) => {
        drawStartedAt ??= performance.now();
        card.match = transition(card.match, { type: "drawComplete", path: values });
        if (!band) {
          band = createBandControl(
            puzzle.typicalMove,
            puzzle.unit,
            (multiplier) => {
              card.match = transition(card.match, { type: "bandChange", multiplier });
              paint(card);
            },
            `band-input-${card.number}`,
          );
          card.controls.prepend(band);
        }
        updateLock();
      },
    );
    card.drawing = drawing;
    const stop = () => {
      card.chartSlot.removeEventListener("pointerdown", startDrawing, true);
      card.chartSlot.removeEventListener("pointerup", endDrawing);
      card.chartSlot.removeEventListener("pointercancel", endDrawing);
      drawing.destroy();
      delete card.drawing;
      card.controls.replaceChildren();
    };

    lock.addEventListener("click", () => {
      // The clock only stops the offer; the Worker refuses late entries whatever this says.
      if (liveState(entry, options.now()) !== "pending") {
        stop();
        paint(card);
        showNote(card, noteFor(card, puzzle, "closed"));
        return;
      }
      if (card.match.kind !== "drawn") return;
      const { forecast } = card.match;
      const saved: LiveEntryRecord = {
        puzzleId: puzzle.id,
        path: [...forecast.path],
        halfWidth: forecast.multiplier * puzzle.typicalMove,
        msToLock: Math.min(MAX_LOCK_MS, Math.round(performance.now() - (drawStartedAt ?? shownAt))),
        status: "unsent",
      };
      if (!options.entries.save(saved)) {
        showNote(card, {
          kind: "notice",
          what: "This entry could not be saved. Your drawing is still here. Free device storage and press Lock again.",
        });
        card.note.focus();
        return;
      }
      card.saved = saved;
      card.match = transition(card.match, { type: "lock" });
      stop();
      paint(card);
      send(card, puzzle);
      card.note.focus();
    });
    paint(card);
    return stop;
  };

  /** A locked entry is drawn in every state; once resolved it is scored like a daily play. */
  const showSaved = (card: LiveCard, puzzle: LivePuzzle) => {
    const saved = card.saved;
    if (!saved) return;
    if (card.state === "pending") {
      // An entry that never reached the Worker goes again while the round is open; a repeat
      // of one that did arrive comes back as a duplicate, which counts as sent.
      if (saved.status === "unsent") send(card, puzzle);
      else
        showNote(card, noteFor(card, puzzle, saved.status === "sent" ? "entered" : saved.status));
      return;
    }
    const notes: HTMLElement[] = [];
    if (card.state === "resolved" && card.forecast && card.answer) {
      const { you, ai } = scoreMatch(
        { typicalMove: puzzle.typicalMove, ai: card.forecast },
        { path: saved.path, multiplier: saved.halfWidth / puzzle.typicalMove },
        { id: puzzle.id, actual: card.answer.actual, dates: card.answer.dates },
      );
      const result = paragraph(
        "live-result",
        messages.live.result(you.closeness, ai.closeness, verdict(you, ai), you.coverage),
      );
      notes.push(result);
    } else if (card.state === "awaiting" && saved.status === "sent") {
      notes.push(panel(messages.live.awaitingEntry(instant(puzzle.resolvesUtc))));
    }
    if (saved.status !== "sent")
      notes.push(
        panel(
          saved.status === "unsent"
            ? messages.live.notCounted
            : noteFor(card, puzzle, saved.status),
        ),
      );
    card.note.replaceChildren(...notes);
  };

  return { startEntry, showSaved };
}
