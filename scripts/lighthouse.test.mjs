import assert from "node:assert/strict";
import { test } from "node:test";
import { measured, medians, resultRows } from "./lighthouse-metrics.mjs";

test("serial measurements report the middle LCP without hiding individual failures", () => {
  const runs = [
    [100, 100, 1400, 0, 130000],
    [99, 100, 1499, 0.01, 130000],
    [100, 100, 2000, 0, 130000],
  ];
  assert.deepEqual(medians(runs), [100, 100, 1499, 0, 130000]);
  assert.equal(
    resultRows(medians(runs)).every((row) => row.passed),
    true,
  );
  assert.equal(
    runs.flatMap(resultRows).every((row) => row.passed),
    false,
  );
});

test("every budget boundary remains strict and rejects nonfinite measurements", () => {
  assert.deepEqual(
    resultRows([95, 100, 1499, 0.019, 219999]).map((row) => row.passed),
    Array(5).fill(true),
  );
  assert.deepEqual(
    resultRows([94, 99, 1500, 0.02, 220000]).map((row) => row.passed),
    Array(5).fill(false),
  );
  assert.deepEqual(
    resultRows(Array(5).fill(NaN)).map((row) => row.passed),
    Array(5).fill(false),
  );
  assert.throws(() => medians([]));
});

test("a loading shell cannot supply a playable measurement", () => {
  const report = {
    categories: { performance: { score: 1 }, accessibility: { score: 1 } },
    audits: {
      "largest-contentful-paint": { numericValue: 1000 },
      "cumulative-layout-shift": { numericValue: 0 },
      "user-timings": { details: { items: [] } },
    },
  };
  assert.throws(() => measured(report, 130000), /puzzle did not become interactive/u);
  report.audits["user-timings"].details.items.push({
    name: "forecastle:interactive",
    timingType: "Mark",
  });
  assert.deepEqual(measured(report, 130000), [100, 100, 1000, 0, 130000]);
});
