type LineEnd = { readonly id: string; readonly y: number };

/** Place label centres inside the bounds without changing their vertical order. */
export function placeLineLabels(
  ends: readonly LineEnd[],
  labelHeight: number,
  yMin: number,
  yMax: number,
): LineEnd[] {
  if (labelHeight <= 0 || yMax - yMin < (ends.length - 1) * labelHeight)
    throw new Error("Insufficient room for line labels.");
  const labels = ends.map((end) => ({ ...end })).sort((a, b) => a.y - b.y);
  let previous = yMin - labelHeight;
  for (const label of labels) {
    label.y = Math.max(label.y, previous + labelHeight);
    previous = label.y;
  }
  let next = yMax + labelHeight;
  for (const label of [...labels].reverse()) {
    label.y = Math.min(label.y, next - labelHeight);
    next = label.y;
  }
  return labels;
}
