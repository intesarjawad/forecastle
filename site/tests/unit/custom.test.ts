import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { decodeCustomPayload, parseCustomPuzzle } from "../../src/core/custom";
import payload from "../fixtures/custom-payload.json" with { type: "json" };

const encoded = readFileSync(new URL("../fixtures/custom-payload.txt", import.meta.url), "utf8");

function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

test("decodes the shared link payload to exactly the recorded JSON", () => {
  expect(decodeCustomPayload(encoded)).toEqual(payload);
});

test("parses the payload and computes its geometry from the series", () => {
  const result = parseCustomPuzzle(payload);
  expect(result.source).toBe("Wikipedia pageviews (CC0)");
  expect(result.label).toBe("Pumpkin pageviews");
  expect(result.unit).toBe("views");
  expect(result.visible).toEqual(payload.visible);
  expect(result.actual).toEqual([1785, 1726, 1679, 1608, 1684, 1791, 1867]);
  // The visible values run from 1566 to 1918, padded by 0.4 of that range on each side.
  expect(result.yDomain[0]).toBeCloseTo(1425.2, 9);
  expect(result.yDomain[1]).toBeCloseTo(2058.8, 9);
  expect(result.typicalMove).toBeCloseTo(72.14814814814815, 9);
  expect(result.ai).toEqual({
    forecaster: "amazon/chronos-2",
    revision: "29ec3766d36d6f73f0696f85560a422f50e8498c",
    ...payload.ai,
  });
});

test("gives a flat series a domain with height", () => {
  const flat = { ...payload, visible: payload.visible.map(() => 1750) };
  expect(parseCustomPuzzle(flat).yDomain).toEqual([1679 - 9.7, 1873 + 9.7]);
});

test("keeps an HTML-looking label as literal text", () => {
  const label = '<img src=x onerror="alert(1)">';
  expect(parseCustomPuzzle({ ...payload, label }).label).toBe(label);
});

test("accepts an empty source and unit", () => {
  const result = parseCustomPuzzle({ ...payload, source: "", unit: "" });
  expect(result.source).toBe("");
  expect(result.unit).toBe("");
});

test.each([
  ["an oversized link", "A".repeat(4097)],
  ["an empty link", ""],
  ["characters outside base64url", "not base64url!"],
  ["base64url that is not JSON", base64url("not json")],
])("rejects %s", (_name, value) => {
  expect(() => decodeCustomPayload(value)).toThrow();
});

test.each([
  ["a null body", null],
  ["an array body", []],
  ["a version other than 1", { ...payload, v: 2 }],
  ["an extra key", { ...payload, typicalMove: 72 }],
  ["6 actual values", { ...payload, actual: payload.actual.slice(1) }],
  ["an empty model", { ...payload, model: "" }],
  ["an 81-character model", { ...payload, model: "m".repeat(81) }],
  ["a 41-character source", { ...payload, source: "x".repeat(41) }],
  ["an empty label", { ...payload, label: "" }],
  ["an 81-character label", { ...payload, label: "x".repeat(81) }],
  ["a 17-character unit", { ...payload, unit: "x".repeat(17) }],
  ["27 visible values", { ...payload, visible: payload.visible.slice(1) }],
  ["29 visible values", { ...payload, visible: [...payload.visible, 1700] }],
  ["a NaN visible value", { ...payload, visible: [Number.NaN, ...payload.visible.slice(1)] }],
  ["an infinite visible value", { ...payload, visible: [Infinity, ...payload.visible.slice(1)] }],
  ["a visible value above 1e100", { ...payload, visible: [1e101, ...payload.visible.slice(1)] }],
  ["a 6-value median", { ...payload, ai: { ...payload.ai, median: payload.ai.median.slice(1) } }],
  ["an 8-value q10", { ...payload, ai: { ...payload.ai, q10: [...payload.ai.q10, 1670] } }],
  [
    "a NaN q90",
    { ...payload, ai: { ...payload.ai, q90: [Number.NaN, ...payload.ai.q90.slice(1)] } },
  ],
  [
    "crossed lower quantiles",
    { ...payload, ai: { ...payload.ai, q10: [1771, ...payload.ai.q10.slice(1)] } },
  ],
  [
    "crossed upper quantiles",
    { ...payload, ai: { ...payload.ai, q90: [1769, ...payload.ai.q90.slice(1)] } },
  ],
  ["an extra forecast key", { ...payload, ai: { ...payload.ai, spread: 1 } }],
  [
    "a missing forecast key",
    { ...payload, ai: { median: payload.ai.median, q10: payload.ai.q10 } },
  ],
])("rejects %s", (_name, value) => {
  expect(() => parseCustomPuzzle(value)).toThrow();
});

test("rejects a payload with a missing top-level key", () => {
  const missing: Record<string, unknown> = { ...payload };
  delete missing.source;
  expect(() => parseCustomPuzzle(missing)).toThrow();
});
