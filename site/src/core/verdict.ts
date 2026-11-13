type Result = { readonly closeness: number; readonly coverage: number };

/** Compare Closeness first, then the number of days caught by each band. */
export function verdict(you: Result, ai: Result): string {
  const difference = you.closeness - ai.closeness;
  const points = (count: number) => `${count} ${count === 1 ? "point" : "points"}`;
  if (difference > 0) return `You beat the AI by ${points(difference)}`;
  if (difference < 0) return `The AI beat you by ${points(-difference)}`;
  if (you.coverage > ai.coverage) return "You beat the AI on the band";
  if (you.coverage < ai.coverage) return "The AI beat you on the band";
  return "Draw";
}

/**
 * Name what decided the verdict, so the day marks on a shared sheet cannot be misread as the
 * score: Closeness decides unless the rounded scores tie, and only then the band counts.
 */
export function reason(you: Result, ai: Result): string {
  const [high, low] = [
    Math.max(you.closeness, ai.closeness),
    Math.min(you.closeness, ai.closeness),
  ];
  if (high !== low) return `Closer overall, ${high} to ${low} (100 is exact)`;
  if (you.coverage !== ai.coverage) {
    return `Level at ${high}; your band caught ${you.coverage} of 7 days, the AI's ${ai.coverage}`;
  }
  return `Level at ${high}, and both bands caught ${you.coverage} of 7 days`;
}
