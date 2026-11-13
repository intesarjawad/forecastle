import { isCalendarDate } from "../core/dates";
import type { Answer } from "../core/state";
import { MAX_ABSOLUTE_VALUE } from "./scoring";

const DAY_MS = 86_400_000;

/** Validate the answer before its values enter the chart or scoring functions. */
export function parseAnswer(value: unknown, id: string): Answer {
  if (typeof value !== "object" || value === null || !("id" in value) || value.id !== id)
    throw new Error("Answer id does not match its puzzle.");
  if (!("actual" in value) || !Array.isArray(value.actual) || value.actual.length !== 7)
    throw new Error("Answer requires seven actual values.");
  const actual = Array.from(value.actual, (item: unknown) => {
    if (typeof item !== "number" || !Number.isFinite(item) || Math.abs(item) > MAX_ABSOLUTE_VALUE)
      throw new Error("Invalid answer value.");
    return item;
  });
  if (!("dates" in value) || !Array.isArray(value.dates) || value.dates.length !== 35)
    throw new Error("Answer requires 35 dates.");
  const dates = Array.from(value.dates, (item: unknown) => {
    if (!isCalendarDate(item)) throw new Error("Invalid answer date.");
    return item;
  });
  if (
    dates
      .slice(1)
      .some((date, index) => Date.parse(date) - Date.parse(dates[index] ?? "") !== DAY_MS)
  )
    throw new Error("Answer dates must be consecutive days.");
  return { id, actual, dates };
}

/** Fetch only when the match has accepted a lock or an explicit retry. */
export async function loadAnswer(id: string): Promise<Answer> {
  const response = await fetch(`${import.meta.env.BASE_URL}puzzles/${id}/answer.json`);
  if (!response.ok) throw new Error(`Answer request failed (${response.status}).`);
  const value: unknown = await response.json();
  return parseAnswer(value, id);
}
