const MS_PER_DAY = 86_400_000;
const DAYS_PER_PUZZLE = 7;
const CALIBRATION_STRIP_PUZZLES = 14;
const PERCENT_SCALE = 100;

/** Daily plays only; coverages are counts out of seven, in play order. */
export interface DailyHistory {
  readonly playedOn: readonly string[];
  readonly coverages: readonly number[];
}

/** Exclude archive plays and keep the first result when a local date is replayed. */
export function recordDailyPlay(
  history: DailyHistory,
  puzzleDate: string,
  playedOn: string,
  coverage: number,
): DailyHistory {
  if (puzzleDate !== playedOn || history.playedOn.includes(playedOn)) return history;
  return {
    playedOn: [...history.playedOn, playedOn],
    coverages: [...history.coverages, coverage],
  };
}

/** Current streak survives until an unplayed day ends; best includes completed runs. */
export function streakStats(
  history: DailyHistory,
  today: string,
): { current: number; best: number } {
  const days = [...new Set(history.playedOn)]
    .map((day) => Date.parse(day) / MS_PER_DAY)
    .sort((a, b) => a - b);
  let run = 0;
  let best = 0;
  let currentRun = 0;
  let lastCurrentDay: number | undefined;
  const todayDay = Date.parse(today) / MS_PER_DAY;
  let previous: number | undefined;
  for (const day of days) {
    run = previous !== undefined && day === previous + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    if (day <= todayDay) {
      currentRun = run;
      lastCurrentDay = day;
    }
    previous = day;
  }
  const current = lastCurrentDay !== undefined && todayDay - lastCurrentDay <= 1 ? currentRun : 0;
  return { current, best };
}

/** Lifetime coverage percentage and the latest fourteen raw coverage counts. */
export function calibrationStats(history: DailyHistory): {
  puzzleCount: number;
  coveragePercent: number | null;
  recentCoverages: number[];
} {
  const puzzleCount = history.coverages.length;
  const caughtDays = history.coverages.reduce((sum, count) => sum + count, 0);
  return {
    puzzleCount,
    coveragePercent:
      puzzleCount === 0 ? null : (caughtDays / (puzzleCount * DAYS_PER_PUZZLE)) * PERCENT_SCALE,
    recentCoverages: history.coverages.slice(-CALIBRATION_STRIP_PUZZLES),
  };
}
