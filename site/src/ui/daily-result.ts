import { localDateForInstant } from "../core/dates";
import type { Stats } from "../core/history";
import { shareText } from "../core/share";
import type { Answer, Forecast } from "../core/state";
import type { Puzzle } from "../io/puzzle-validation";
import { type createPlayStore, dailyHistory, type Play } from "../io/storage";
import type { CustomMatch } from "./daily";
import type { Ink } from "./ink";
import type { MatchShell } from "./lesson";
import { revealMatch, scoreMatch } from "./reveal";
import { mountSharePanel, recordLines } from "./share-panel";

type DailyResult = {
  readonly shell: MatchShell;
  readonly ink: Ink;
  readonly puzzle: Puzzle;
  readonly forecast: Forecast;
  readonly answer: Answer;
  readonly arrival: number;
  readonly custom: CustomMatch | undefined;
  readonly played: Play | undefined;
  readonly history: { plays: Play[] };
  readonly store: ReturnType<typeof createPlayStore>;
  readonly stats: Stats | null;
  readonly warnStorageBlocked: () => void;
};

export function revealDaily({
  shell,
  ink,
  puzzle,
  forecast,
  answer,
  arrival,
  custom,
  played,
  history,
  store,
  stats,
  warnStorageBlocked,
}: DailyResult) {
  const lessonRoot = shell.lesson;
  const scoreline = document.getElementById("scoreline");
  const live = document.getElementById("match-live");
  if (!scoreline || !live) throw new Error("The match requires result and announcement slots.");
  const stopReveal = revealMatch(
    scoreline,
    { lesson: lessonRoot, ink },
    live,
    puzzle,
    forecast,
    answer,
    arrival,
    played !== undefined,
  );
  const slot = scoreline.querySelector<HTMLElement>(".share-slot");
  if (!slot) throw new Error("The result requires a share slot.");
  const { you, ai } = scoreMatch(puzzle, forecast, answer);
  let recorded = false;
  const instant = Date.now();
  const today = localDateForInstant(instant, new Date(instant).getTimezoneOffset());
  if (!custom && !played) {
    const play = {
      puzzleId: puzzle.id,
      kind: "daily",
      playedOn: today,
      path: forecast.path,
      halfWidth: forecast.multiplier * puzzle.typicalMove,
      closeness: you.closeness,
      aiCloseness: ai.closeness,
      coverage: you.coverage,
      stats,
    } as const;
    history.plays = [...history.plays, play];
    recorded = store.save(play);
    if (!recorded) warnStorageBlocked();
  }
  const text = custom
    ? shareText({
        kind: "custom",
        you: you.closeness,
        ai: ai.closeness,
        youCells: you.cells,
        aiCells: ai.cells,
        bandCaught: you.coverage,
        link: custom.link,
      })
    : shareText({
        kind: "daily",
        number: puzzle.number,
        you: you.closeness,
        ai: ai.closeness,
        youCells: you.cells,
        aiCells: ai.cells,
        bandCaught: you.coverage,
        link: new URL(`${import.meta.env.BASE_URL}#/p/${puzzle.id}`, location.href).href,
      });
  const stopShare = mountSharePanel(slot, {
    text,
    lines: custom ? [] : recordLines(dailyHistory(history.plays), today, puzzle.id),
    now: Date.now,
  });

  return {
    recorded,
    dispose: () => {
      stopReveal();
      stopShare();
    },
  };
}
