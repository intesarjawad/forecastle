export type SubmitRateEntry = {
  readonly from: string;
  readonly to: string;
  readonly rate: number;
};

/** Request share for a validated UTC calendar date, including both endpoints. */
export function submitRate(schedule: readonly SubmitRateEntry[], utcDate: string): number {
  return schedule.find(({ from, to }) => from <= utcDate && utcDate <= to)?.rate ?? 1;
}
