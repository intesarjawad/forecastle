export const budgets = [
  ["Performance", ">= 95", (n) => n >= 95],
  ["Accessibility", "100", (n) => n === 100],
  ["LCP (ms)", "< 1500", (n) => n < 1500],
  ["CLS", "< 0.02", (n) => n < 0.02],
  ["Compressed HTML, JS, CSS and fonts (bytes)", "< 220000", (n) => n < 220_000],
];

export function measured(report, bytes) {
  const ready = report.audits["user-timings"]?.details?.items?.some(
    (entry) => entry.name === "forecastle:interactive" && entry.timingType === "Mark",
  );
  if (!ready) throw new Error("The puzzle did not become interactive.");
  return [
    report.categories.performance.score * 100,
    report.categories.accessibility.score * 100,
    report.audits["largest-contentful-paint"].numericValue,
    report.audits["cumulative-layout-shift"].numericValue,
    bytes,
  ];
}

export function resultRows(values) {
  return budgets.map(([name, budget, accepts], index) => {
    const value = values[index];
    return { name, value, budget, passed: Number.isFinite(value) && accepts(value) };
  });
}

export function medians(runs) {
  if (runs.length === 0) throw new Error("At least one measurement is required.");
  return budgets.map((_, index) => {
    const values = runs.map((run) => run[index]).sort((a, b) => a - b);
    const middle = Math.floor(values.length / 2);
    return values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2;
  });
}
