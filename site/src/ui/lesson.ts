import { footerElement, navElement } from "./page";
import { COLUMNS, type SheetFrame } from "./sheet";

export type MatchShell = {
  readonly lesson: HTMLElement;
  readonly chart: HTMLElement;
  readonly controls: HTMLElement;
};

const READ_HINT_KEY = "forecastle:read-hint";

/** The right-to-left hint shows once per browser; a blocked store simply shows it again. */
function readHintSeen(): boolean {
  try {
    return localStorage.getItem(READ_HINT_KEY) === "seen";
  } catch {
    return false;
  }
}

/** A first stroke or key on the sheet means the reading order has been met. */
export function retireReadHint(): void {
  try {
    localStorage.setItem(READ_HINT_KEY, "seen");
  } catch {
    // Without storage the hint returns on the next visit, which is harmless.
  }
}

export function mountMatchShell(app: HTMLElement): MatchShell {
  app.className = "lesson-page";
  app.setAttribute("aria-label", "Forecastle daily lesson");
  const heads = COLUMNS.map(
    (column) =>
      `<p class="column-head head-${column}" data-head="${column}"><span class="head-name"></span><span class="head-days"></span></p>`,
  ).join("");
  const bodies = COLUMNS.map(
    (column) => `<div class="col-body body-${column}" data-col="${column}"></div>`,
  ).join("");
  app.innerHTML = `
  <header class="masthead">
    <h1 class="wordmark">Forecastle</h1>
    <p class="match-number" id="match-number"></p>
  </header>
  <div class="lesson is-pending" id="lesson" aria-busy="true">
    <h2 class="series" id="series">
      <span class="series-name" id="series-name"></span>
      <span class="unit" id="series-unit"></span>
      <span class="series-dates" id="series-dates"></span>
    </h2>
    ${heads}
    ${bodies}
    <div class="your-prompt" id="your-prompt">
      <p class="prompt-line" id="prompt-line"></p>
      <div class="doubt-swatch">
        <canvas class="swatch-ink" id="swatch-ink" width="116" height="56" aria-hidden="true"></canvas>
        <p class="swatch-labels"><span>sure</span><span>unsure</span></p>
        <p class="swatch-note">A wider brush means more doubt.</p>
      </div>
    </div>
    <div class="copy-cover" id="copy-cover"><p>Opens when you hand in yours</p></div>
    <div class="chart" id="chart"><p role="status">Loading puzzle…</p></div>
    <div class="controls" id="controls"></div>
    <section class="scoreline" id="scoreline" aria-label="Match score">
      <div class="score-pair score-ai"><span class="score-name visually-hidden">AI</span><span id="ai-score" class="score ai-score" role="img" aria-label="Score available after lock"></span></div>
      <div class="score-pair score-you"><span class="score-name visually-hidden">You</span><span id="you-score" class="score you-score" role="img" aria-label="Score available after lock"></span></div>
    </section>
  </div>
  <nav class="page-nav" id="page-nav"></nav>
  <p id="match-live" class="visually-hidden" aria-live="polite" aria-atomic="true"></p>
`;
  // The game comes before the links, so the first Tab lands on the first day's handle.
  const nav = document.getElementById("page-nav");
  if (nav) nav.replaceWith(navElement());
  app.append(footerElement());
  const lesson = document.querySelector<HTMLElement>("#lesson");
  const chart = document.querySelector<HTMLElement>("#chart");
  const controls = document.querySelector<HTMLElement>("#controls");
  if (!lesson || !chart || !controls)
    throw new Error("The lesson requires its sheet and controls.");
  // A first visit is told the reading order once, inside the empty column where the brush goes.
  const prompt = document.getElementById("prompt-line");
  if (prompt)
    prompt.textContent = readHintSeen()
      ? "Brush the next seven days, from today"
      : "Read right to left, then brush down from today";
  return { lesson, chart, controls };
}

/** Pixel rectangles of the column bodies, relative to the sheet; hidden columns are null. */
export function measureSheet(lesson: HTMLElement): SheetFrame {
  const box = lesson.getBoundingClientRect();
  const columns = Object.fromEntries(
    COLUMNS.map((column) => {
      const rect = lesson.querySelector(`[data-col="${column}"]`)?.getBoundingClientRect();
      return [
        column,
        rect && rect.width > 0 && rect.height > 0
          ? {
              x: rect.left - box.left,
              y: rect.top - box.top,
              width: rect.width,
              height: rect.height,
            }
          : null,
      ];
    }),
  ) as SheetFrame["columns"];
  return { width: box.width, height: box.height, columns };
}

export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
