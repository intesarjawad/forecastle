const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/** Validate calendar dates before formatting untrusted storage, files, or routes. */
export function isCalendarDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}

/** Daily puzzle id, or null before launch. */
export function puzzleIdForLocalDate(launchDate: string, localDate: string): string | null {
  return localDate < launchDate ? null : localDate;
}

/** One-based puzzle number, counting calendar days independently of DST. */
export function puzzleNumber(launchDate: string, localDate: string): number | null {
  if (localDate < launchDate) return null;
  return (Date.parse(localDate) - Date.parse(launchDate)) / MS_PER_DAY + 1;
}

/** Local calendar date using the Date.getTimezoneOffset convention: UTC minus local. */
export function localDateForInstant(nowMs: number, tzOffsetMin: number): string {
  return new Date(nowMs - tzOffsetMin * MS_PER_MINUTE).toISOString().slice(0, 10);
}

/** Time to the next local midnight, resolved to a timestamp by the caller using its timezone. */
export function msToLocalMidnight(nowMs: number, nextMidnightMs: number): number {
  return nextMidnightMs - nowMs;
}
