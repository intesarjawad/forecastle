import constants from "../../../scoring/constants.json";
import { closeness, coverage, dayCells } from "../core/scoring";
import type { Answer, Forecast } from "../core/state";
import type { Cell, Interval } from "../core/types";
import { reason, verdict } from "../core/verdict";
import type { Puzzle } from "../io/puzzle-validation";
import type { Ink } from "./ink";
import type { LiveForecast } from "./live";

const CELL_DESCRIPTIONS: Record<Cell, string> = {
  green: "very close",
  yellow: "close",
  white: "missed, unmarked",
};

/** The reveal's cubic-bezier(0.23, 1, 0.32, 1), including its time coordinate. */
export function revealProgress(elapsed: number, delay: number, duration: number): number {
  const progress = Math.max(0, Math.min(1, (elapsed - delay) / duration));
  if (progress === 0 || progress === 1) return progress;
  let lower = 0;
  let upper = 1;
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const t = (lower + upper) / 2;
    const x = 3 * (1 - t) ** 2 * t * 0.23 + 3 * (1 - t) * t ** 2 * 0.32 + t ** 3;
    if (x < progress) lower = t;
    else upper = t;
  }
  return 1 - (1 - (lower + upper) / 2) ** 3;
}

function cells(values: readonly Cell[], name: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "day-cells";
  row.setAttribute("role", "list");
  row.setAttribute("aria-label", `${name} day results`);
  values.forEach((value, index) => {
    const cell = document.createElement("span");
    cell.className = `day-cell cell-${value}`;
    cell.setAttribute("role", "listitem");
    cell.setAttribute("aria-label", `Day ${index + 1}: ${CELL_DESCRIPTIONS[value]}`);
    row.append(cell);
  });
  return row;
}

/** Both sides' scores, band coverage and day cells for a finished match. */
export function scoreMatch(
  puzzle: {
    readonly typicalMove: number;
    readonly ai: Pick<LiveForecast, "median" | "q10" | "q90">;
  },
  forecast: Forecast,
  answer: Answer,
) {
  const halfWidth = forecast.multiplier * puzzle.typicalMove;
  const band = {
    lower: forecast.path.map((value) => value - halfWidth),
    upper: forecast.path.map((value) => value + halfWidth),
  };
  const side = (path: readonly number[], interval: Interval) => ({
    closeness: closeness(path, answer.actual, puzzle.typicalMove, constants.k),
    coverage: coverage(interval, answer.actual),
    cells: dayCells(path, answer.actual, puzzle.typicalMove),
  });
  return {
    you: side(forecast.path, band),
    ai: side(puzzle.ai.median, { lower: puzzle.ai.q10, upper: puzzle.ai.q90 }),
  };
}

const MARK_KEY = [
  ["green", "within 1 typical move"],
  ["yellow", "within 2"],
] as const;

function markKey(glyph: Ink["markGlyph"]): HTMLElement {
  const key = document.createElement("p");
  key.className = "mark-key result-note later";
  // The marks grade each day; the prefix keeps a stranger from counting them as the score.
  key.append("Each day:");
  for (const [shape, text] of MARK_KEY) {
    const item = document.createElement("span");
    item.className = "mark-key-item";
    item.innerHTML = glyph(shape) ?? "";
    item.append(text);
    key.append(item);
  }
  const none = document.createElement("span");
  none.className = "mark-key-item";
  none.textContent = "unmarked: further";
  key.append(none);
  return key;
}

/**
 * The teacher's correction uses one clock, so late frames catch up together rather than
 * delaying later marks. The AI's sheet unfolds, the real week is brushed down both columns, each
 * day gets its mark, the scores are written and the winner is circled. A settled reveal, like
 * reduced motion, prints the corrected sheet at once.
 */
export function revealMatch(
  root: HTMLElement,
  sheet: { readonly lesson: HTMLElement; readonly ink: Ink },
  live: HTMLElement,
  puzzle: Puzzle,
  forecast: Forecast,
  answer: Answer,
  arrivalMs: number,
  settled = false,
): () => void {
  const { you, ai } = scoreMatch(puzzle, forecast, answer);
  delete root.dataset.reveal;
  const stampText = verdict(you, ai);
  const reasonText = reason(you, ai);
  const style = getComputedStyle(document.documentElement);
  // The production build rewrites durations to their shortest form, so 2000ms arrives as 2s.
  const time = (token: string) => {
    const value = style.getPropertyValue(token).trim();
    return Number.parseFloat(value) * (value.endsWith("ms") ? 1 : 1000);
  };
  const duration = time("--duration-reveal");
  // Read once: the tokens do not change during a reveal, and reading them costs a style lookup.
  const timing = {
    real: time("--delay-real"),
    realCopy: time("--delay-real-copy"),
    realLength: time("--duration-real"),
    scores: time("--delay-scores"),
    scoresLength: time("--duration-scores"),
    circle: time("--delay-circle"),
    circleLength: time("--duration-circle"),
    stamp: time("--delay-stamp"),
    stampLength: time("--duration-stamp"),
  };
  const mark = time("--duration-mark");
  const stagger = time("--duration-mark-stagger");
  const marksAt = time("--delay-marks");
  root.innerHTML = `
    <div class="score-pair score-ai"><span class="score-name visually-hidden">AI</span><span id="ai-score" class="score ai-score"></span></div>
    <div class="score-pair score-you"><span class="score-name visually-hidden">You</span><span id="you-score" class="score you-score"></span></div>
    <div class="result">
      <p class="result-stamp"></p>
      <p class="result-reason"></p>
      <div class="share-slot later"></div>
      <div class="day-grid visually-hidden"></div>
      <a class="scoring-link later" href="#/how">How scoring works</a>
    </div>
  `;
  const required = (selector: string) => {
    const element = root.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Result requires ${selector}.`);
    return element;
  };
  const youScore = required("#you-score");
  const aiScore = required("#ai-score");
  const [youText, aiText] = [youScore, aiScore].map((score) => {
    const text = document.createElement("span");
    text.className = "visually-hidden";
    score.append(text);
    return text;
  }) as [HTMLElement, HTMLElement];
  const stamp = required(".result-stamp");
  stamp.textContent = stampText;
  const lead = Math.sign(you.closeness - ai.closeness) || Math.sign(you.coverage - ai.coverage);
  const winner = lead > 0 ? "you" : lead < 0 ? "ai" : null;
  const because = required(".result-reason");
  because.textContent = reasonText;
  because.after(markKey(sheet.ink.markGlyph));
  const youCells = cells(you.cells, "You");
  const aiCells = cells(ai.cells, "AI");
  required(".day-grid").append(youCells, aiCells);
  sheet.ink.lesson({
    actual: answer.actual,
    paths: { you: forecast.path, ai: puzzle.ai.median },
    cells: { you: you.cells, ai: ai.cells },
    winner,
    scores: { you: you.closeness, ai: ai.closeness },
    boxes: () => {
      const sheetBox = sheet.lesson.getBoundingClientRect();
      const within = (element: HTMLElement) => {
        const box = element.getBoundingClientRect();
        return {
          x: box.left - sheetBox.left,
          y: box.top - sheetBox.top,
          width: box.width,
          height: box.height,
        };
      };
      return { you: within(youScore), ai: within(aiScore) };
    },
  });
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let frame = 0;
  let measured = false;
  let finished = false;
  let painted = "";
  const paint = (elapsed: number) => {
    const progress = (delay: number, length: number) => revealProgress(elapsed, delay, length);
    const correction = {
      real: [
        progress(timing.real, timing.realLength),
        progress(timing.realCopy, timing.realLength),
      ] as const,
      marks: you.cells.map(
        (_, day) =>
          [
            progress(marksAt + day * stagger, mark),
            progress(marksAt + day * stagger + stagger / 2, mark),
          ] as const,
      ),
      scores: progress(timing.scores, timing.scoresLength),
      circle: progress(timing.circle, timing.circleLength),
    };
    const scores = correction.scores;
    // The figures are brushed onto the sheet; the text beneath them is for assistive technology,
    // and stays empty until the teacher writes, so no false 0 sits beside the marks.
    if (scores > 0 && youText.textContent === "") {
      youText.textContent = String(you.closeness);
      aiText.textContent = String(ai.closeness);
    }
    const key = JSON.stringify(correction);
    if (key !== painted) {
      painted = key;
      sheet.ink.correct(correction);
    }
    const stampProgress = progress(timing.stamp, timing.stampLength);
    stamp.style.opacity = String(stampProgress);
    // What decided the verdict keeps it honest, so it arrives with it.
    because.style.opacity = String(stampProgress);
    if (!measured && elapsed >= marksAt + 6.5 * stagger + mark) {
      measured = true;
      performance.mark("forecastle-last-cell");
      performance.measure(
        "forecastle-answer-to-last-cell",
        "forecastle-answer-arrival",
        "forecastle-last-cell",
      );
    }
    if (elapsed >= duration && !finished) {
      finished = true;
      root.dataset.reveal = "complete";
      live.textContent = `You ${you.closeness}, AI ${ai.closeness}. ${stampText}. ${reasonText}.`;
    }
  };
  const tick = () => {
    paint(settled || reducedMotion.matches ? duration : performance.now() - arrivalMs);
    if (!finished) frame = requestAnimationFrame(tick);
  };
  const reduce = () => {
    if (reducedMotion.matches) {
      cancelAnimationFrame(frame);
      paint(duration);
    }
  };
  reducedMotion.addEventListener("change", reduce);
  // The result mounts first, the sheet resizes next, then correction starts on the final canvas.
  if (settled || reducedMotion.matches) tick();
  else
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(tick);
      });
    });
  return () => {
    cancelAnimationFrame(frame);
    reducedMotion.removeEventListener("change", reduce);
  };
}
