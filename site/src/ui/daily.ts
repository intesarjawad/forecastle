import type { Stats } from "../core/history";
import { type Answer, DEFAULT_BAND_MULTIPLIER, type MatchState, transition } from "../core/state";
import { loadAnswer } from "../io/answers";
import type { PuzzleLoad } from "../io/puzzles";
import type { createPlayStore, Play } from "../io/storage";
import type { createSubmission } from "../io/submissions";
import { createBandControl } from "./band";
import { loadDisplayFace } from "./display-font";
import { createDrawing } from "./draw";
import { createInk } from "./ink";
import { loadInstallAssets } from "./install";
import { type MatchShell, retireReadHint, token } from "./lesson";
import { createLessonRenderer } from "./lesson-renderer";
import { messages } from "./messages";
import { pageFailed, paragraph } from "./page";
import { dateRange, weekHeads } from "./sheet";
import { wetInk } from "./wet-ink";

const LONG_TITLE_CHARACTERS = 48;

type DailyOptions = {
  readonly history: { plays: Play[] };
  readonly store: ReturnType<typeof createPlayStore>;
  readonly warnStorageBlocked: () => void;
  readonly submissionDependencies: Parameters<typeof createSubmission>[1];
  readonly showPuzzle: (state: PuzzleLoad) => void;
};

export type CustomMatch = {
  readonly answer: Answer;
  readonly link: string;
  readonly source: string;
};

export function mountPuzzle(
  current: MatchShell,
  state: PuzzleLoad,
  options: DailyOptions,
  custom?: CustomMatch,
): () => void {
  const { history, store, warnStorageBlocked, submissionDependencies } = options;
  const chartSlot = current.chart;
  const controlsSlot = current.controls;
  const lessonRoot = current.lesson;
  let disposed = false;
  lessonRoot.classList.remove("is-pending");
  lessonRoot.removeAttribute("aria-busy");
  chartSlot.replaceChildren();
  // An unpublished day has no sheet to write on, so only the message and its way out show.
  lessonRoot.classList.toggle("is-missing", state.kind === "missing");
  if (state.kind === "missing") {
    loadDisplayFace();
    loadInstallAssets();
    const message = document.createElement("p");
    const copy = messages.puzzleMissing(async () => {
      const next = await state.action.run();
      if (!disposed) options.showPuzzle(next);
    });
    message.textContent = copy.what;
    const action = document.createElement("button");
    action.type = "button";
    action.className = "key-button";
    action.textContent = copy.action.label;
    action.addEventListener("click", () => void copy.action.run());
    chartSlot.replaceChildren(message, action);
    return () => {
      disposed = true;
    };
  }
  const { puzzle } = state;
  if (custom?.source) {
    const source = document.createElement("p");
    source.className = "series-source";
    source.textContent = custom.source;
    lessonRoot.append(source);
  }
  for (const [id, value] of [
    ["series-name", puzzle.label],
    ["series-unit", puzzle.unit],
    ["match-number", custom ? messages.custom.title : `No. ${puzzle.number}`],
  ] as const) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }
  document
    .getElementById("series")
    ?.classList.toggle(
      "is-long-title",
      puzzle.label.length + puzzle.unit.length > LONG_TITLE_CHARACTERS,
    );
  document.getElementById("match-number")?.classList.toggle("custom-title", custom !== undefined);
  const start = puzzle.visible.at(-1);
  if (start === undefined) throw new Error("Drawing requires visible history.");
  for (const [column, name, days] of weekHeads(puzzle.ai.forecaster)) {
    const head = lessonRoot.querySelector(`[data-head="${column}"]`);
    const nameSlot = head?.querySelector(".head-name");
    const daysSlot = head?.querySelector(".head-days");
    if (nameSlot) nameSlot.textContent = name;
    if (daysSlot) daysSlot.textContent = days;
  }
  const seriesDates = document.getElementById("series-dates");
  if (seriesDates) seriesDates.textContent = "";
  let match: MatchState = { kind: "idle" };
  const ink = createInk(lessonRoot, {
    sumi: token("--sumi"),
    shu: token("--shu-ink"),
  });
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let chosen = DEFAULT_BAND_MULTIPLIER;
  ink.band(chosen * puzzle.typicalMove);
  const lock = document.createElement("button");
  lock.type = "button";
  lock.className = "lock-button";
  lock.textContent = "Hand it in";
  lock.disabled = true;
  const band = createBandControl(puzzle.typicalMove, puzzle.unit, (multiplier) => {
    chosen = multiplier;
    match = transition(match, { type: "bandChange", multiplier });
    ink.band(chosen * puzzle.typicalMove);
  });
  // The button sits right under the sheet; the brush width is offered below it once there is
  // a stroke for it to widen, so nothing above the controls moves when it appears.
  band.classList.add("is-waiting");
  controlsSlot.replaceChildren(lock, band);
  let stopResult = () => {};
  let printFrame = 0;
  const played = custom ? undefined : history.plays.find((play) => play.puzzleId === puzzle.id);
  const shownAt = performance.now();
  let drawStartedAt: number | undefined;
  let crowdStats: Stats | null = played?.stats ?? null;
  let pendingStats: Stats | null = null;
  let recorded = false;
  let submission: ReturnType<typeof createSubmission> | undefined;
  const showCrowdNote = (what: string) => {
    if (disposed) return;
    const result = document.querySelector("#scoreline .result");
    if (!result) return;
    const note = paragraph("crowd-note result-note", what);
    note.setAttribute("role", "status");
    result.append(note);
  };

  const updateLock = () => {
    lock.disabled = match.kind !== "drawn";
  };
  const drawing = createDrawing(
    {
      start,
      yDomain: puzzle.yDomain,
      typicalMove: puzzle.typicalMove,
      unit: puzzle.unit,
      halfWidth: () => chosen * puzzle.typicalMove,
      guidance: controlsSlot,
    },
    (values) => {
      match = transition(match, { type: "drawComplete", path: values });
      match = transition(match, { type: "bandChange", multiplier: chosen });
      // A week set from the keyboard is ink on the sheet too, so the prompt gives way.
      lessonRoot.classList.add("has-ink");
      band.classList.remove("is-waiting");
      updateLock();
    },
  );
  const { render, paintCrowd, ready } = createLessonRenderer({
    shell: current,
    puzzle,
    ink,
    drawing,
    state: () => match,
    crowd: () => crowdStats,
    disposed: () => disposed,
  });
  const stopWetInk = wetInk(lessonRoot, ink, reducedMotion, () => drawing.active(), ready);
  const startDrawing = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    if (drawStartedAt === undefined) drawStartedAt = performance.now();
    lessonRoot.classList.add("has-ink");
    retireReadHint();
    match = transition(match, { type: "drawStart" });
    updateLock();
  };
  const endDrawing = () => {
    match = transition(match, { type: "drawEnd" });
    updateLock();
    requestAnimationFrame(() => {
      if (!disposed) render();
    });
  };
  chartSlot.addEventListener("pointerdown", startDrawing, true);
  chartSlot.addEventListener("keydown", retireReadHint);
  chartSlot.addEventListener("pointerup", endDrawing);
  chartSlot.addEventListener("pointercancel", endDrawing);
  const requestAnswer = async () => {
    let answer: Answer;
    if (custom) {
      answer = custom.answer;
    } else {
      try {
        answer = await loadAnswer(puzzle.id);
      } catch {
        if (disposed) return;
        match = transition(match, { type: "answerFailed" });
        const message = document.createElement("p");
        message.className = "answer-error";
        message.setAttribute("role", "status");
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "lock-button";
        const copy = messages.answerFailed(() => {
          match = transition(match, { type: "retry" });
          retry.disabled = true;
          message.textContent = messages.answerLoading.what;
          void requestAnswer();
        });
        message.textContent = copy.what;
        retry.textContent = copy.action.label;
        retry.addEventListener("click", () => void copy.action.run());
        controlsSlot.replaceChildren(message, retry);
        return;
      }
    }
    if (disposed) return;
    const arrival = performance.now();
    performance.mark("forecastle-answer-arrival", { startTime: arrival });
    let revealDaily: typeof import("./daily-result").revealDaily;
    try {
      ({ revealDaily } = await import("./daily-result"));
    } catch {
      if (!disposed) pageFailed(controlsSlot);
      return;
    }
    if (disposed) return;
    match = transition(match, { type: "answerLoaded", answer });
    if (match.kind !== "revealed") return;
    controlsSlot.replaceChildren();
    controlsSlot.hidden = true;
    lessonRoot.classList.toggle("is-settled", played !== undefined);
    lessonRoot.classList.add("is-revealed");
    const [first, last] = [answer.dates[0], answer.dates.at(-1)];
    if (seriesDates && first && last)
      seriesDates.textContent = `${dateRange(first, last)} ${last.slice(0, 4)}`;
    const result = revealDaily({
      shell: current,
      ink,
      puzzle,
      forecast: match.forecast,
      answer: match.answer,
      arrival,
      custom,
      played,
      history,
      store,
      stats: pendingStats,
      warnStorageBlocked,
    });
    recorded = result.recorded;
    stopResult = result.dispose;
    // Result layout and resizing the ink backing stores must not share a frame.
    if (played !== undefined || reducedMotion.matches) render();
    else
      printFrame = requestAnimationFrame(() => {
        printFrame = requestAnimationFrame(() => {
          printFrame = 0;
          if (!disposed) render();
        });
      });
    // The crowd answer may still be in flight; revealing never waits for it.
    submission?.reveal();
  };
  lock.addEventListener("click", () => {
    if (match.kind !== "drawn") return;
    match = transition(match, { type: "lock" });
    if (match.kind !== "locked" || submission) return;
    const endedAt = performance.now();
    const utcDate = new Date().toISOString().slice(0, 10);
    const forecast = match.forecast;
    if (!custom) {
      void import("../io/submissions")
        .then(({ createSubmission }) => {
          submission = createSubmission(
            {
              puzzleId: puzzle.id,
              kind: "daily",
              utcDate,
              saveStats: (stats) => {
                pendingStats = stats;
                const saved = history.plays.find((play) => play.puzzleId === puzzle.id);
                if (!saved || saved.stats === stats) return;
                history.plays = history.plays.map((play) =>
                  play.puzzleId === puzzle.id ? { ...play, stats } : play,
                );
                if (recorded && !store.saveStats(puzzle.id, stats)) warnStorageBlocked();
              },
              onResult: (result) => {
                if (result.kind === "ready") {
                  crowdStats = result.stats;
                  paintCrowd();
                } else if (result.kind === "sampled-out") {
                  showCrowdNote(result.what);
                }
              },
            },
            submissionDependencies,
          );
          submission.lock({
            path: forecast.path,
            halfWidth: forecast.multiplier * puzzle.typicalMove,
            msToLock: Math.min(3_600_000, Math.round(endedAt - (drawStartedAt ?? shownAt))),
          });
          if (match.kind === "revealed") submission.reveal();
        })
        .catch(() => showCrowdNote("Crowd statistics are unavailable."));
    }
    drawing.destroy();
    const input = band.querySelector("input");
    if (input) input.disabled = true;
    lock.disabled = true;
    lock.textContent = messages.answerLoading.what;
    ink.path(match.forecast.path, match.forecast.multiplier * puzzle.typicalMove);
    void requestAnswer();
  });
  let restoring = played !== undefined;
  const resize = new ResizeObserver(() => {
    if (printFrame) return;
    render();
    // The restored chart needs its measured size before the answer can be drawn onto it.
    if (restoring) {
      restoring = false;
      void requestAnswer();
    }
  });
  resize.observe(lessonRoot);
  if (played) {
    match = (
      [
        { type: "drawComplete", path: played.path },
        { type: "bandChange", multiplier: played.halfWidth / puzzle.typicalMove },
        { type: "lock" },
      ] as const
    ).reduce<MatchState>(transition, match);
    chosen = played.halfWidth / puzzle.typicalMove;
    ink.band(played.halfWidth);
    lessonRoot.classList.add("has-ink");
    controlsSlot.replaceChildren();
  }
  return () => {
    disposed = true;
    resize.disconnect();
    controlsSlot.replaceChildren();
    controlsSlot.hidden = false;
    chartSlot.removeEventListener("pointerdown", startDrawing, true);
    chartSlot.removeEventListener("keydown", retireReadHint);
    chartSlot.removeEventListener("pointerup", endDrawing);
    chartSlot.removeEventListener("pointercancel", endDrawing);
    cancelAnimationFrame(printFrame);
    stopResult();
    drawing.destroy();
    stopWetInk();
    ink.destroy();
    lessonRoot.querySelector(".ink-gl")?.remove();
    lessonRoot.classList.remove("is-wet", "has-ink", "is-revealed", "is-settled");
  };
}
