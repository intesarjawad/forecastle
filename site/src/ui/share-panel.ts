import { msToLocalMidnight } from "../core/dates";
import { calibrationStats, type DailyHistory, streakStats } from "../core/streak";

const COPIED_MS = 2_000;
const MINUTE_MS = 60_000;
const MINUTES_PER_HOUR = 60;
const COUNTDOWN_REFRESH_MS = 15_000;
const AIM_PERCENT = 80;
const FALLBACK_ROWS = 5;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Time left to the next local midnight, rounded up so it never reads 0 m early. */
export function countdownText(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / MINUTE_MS));
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  return `Next puzzle in ${hours} h ${String(minutes % MINUTES_PER_HOUR).padStart(2, "0")} m`;
}

/**
 * The streak line. A puzzle played from the archive never joins the streak, so its line says so
 * rather than read as a loss.
 */
export function recordLines(history: DailyHistory, today: string, puzzleDate?: string): string[] {
  const { current, best } = streakStats(history, today);
  const archived = puzzleDate !== undefined && !history.playedOn.includes(puzzleDate);
  return [
    archived
      ? `An archive puzzle, so your streak stays at ${plural(current, "day")}, best ${best}.`
      : `Streak ${plural(current, "day")}, best ${best}.`,
  ];
}

/** The calibration line for the scoring page; it waits for a first daily puzzle. */
export function calibrationLine(history: DailyHistory): string | null {
  const { puzzleCount, coveragePercent } = calibrationStats(history);
  if (coveragePercent === null) return null;
  return `Your band has caught ${Math.round(coveragePercent)}% of real days over ${plural(puzzleCount, "puzzle")}; aim for ${AIM_PERCENT}%.`;
}

function nextLocalMidnight(nowMs: number): number {
  const now = new Date(nowMs);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
}

export function mountSharePanel(
  slot: HTMLElement,
  options: { text: string; lines: readonly string[]; now: () => number },
): () => void {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "key-button share-button";
  button.textContent = "Share";
  const announce = document.createElement("p");
  announce.className = "visually-hidden";
  announce.setAttribute("role", "status");
  const record = options.lines.map((line) => {
    const element = document.createElement("p");
    element.className = "record-line";
    element.textContent = line;
    return element;
  });
  slot.replaceChildren(button, announce, ...record);

  const updateCountdown = () => {
    const now = options.now();
    const streak = record[0];
    if (streak)
      streak.textContent = `${options.lines[0]} ${countdownText(msToLocalMidnight(now, nextLocalMidnight(now)))}`;
  };
  updateCountdown();
  const refresh = setInterval(updateCountdown, COUNTDOWN_REFRESH_MS);

  let revert: ReturnType<typeof setTimeout> | undefined;
  const copied = () => {
    clearTimeout(revert);
    button.textContent = "Copied";
    announce.textContent = "Copied";
    revert = setTimeout(() => {
      button.textContent = "Share";
    }, COPIED_MS);
  };
  let fallback: HTMLTextAreaElement | undefined;
  const showText = () => {
    if (!fallback) {
      const hint = document.createElement("p");
      hint.id = "share-hint";
      hint.className = "share-hint";
      hint.textContent = "Copying is blocked in this browser. Select all and copy.";
      fallback = document.createElement("textarea");
      fallback.className = "share-text";
      fallback.readOnly = true;
      fallback.rows = FALLBACK_ROWS;
      fallback.value = options.text;
      fallback.setAttribute("aria-labelledby", hint.id);
      button.after(hint, fallback);
    }
    fallback.focus();
    fallback.select();
  };
  button.addEventListener("click", () => {
    // writeText must start inside the click for browsers that require a gesture.
    const written = navigator.clipboard?.writeText(options.text) ?? Promise.reject();
    void written.then(copied, showText);
  });
  return () => {
    clearInterval(refresh);
    clearTimeout(revert);
  };
}
