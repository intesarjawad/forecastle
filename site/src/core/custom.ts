import { typicalMove } from "./scoring";
import { chartYDomain } from "./y-scale";

const VISIBLE_DAYS = 28;
const HORIZON = 7;
const MAX_ENCODED_LENGTH = 4096;
const MAX_SOURCE_LENGTH = 40;
const MAX_LABEL_LENGTH = 80;
const MAX_UNIT_LENGTH = 16;
// Mirrors the numeric guard in io/scoring; core cannot import from the I/O layer.
const MAX_ABSOLUTE_VALUE = 1e100;

// The pipeline pads the drawing domain by this share of the visible range.
const DOMAIN_PADDING = 0.4;

const KEYS = [
  "v",
  "label",
  "unit",
  "source",
  "visible",
  "actual",
  "ai",
  "model",
  "revision",
] as const;
const FORECAST_KEYS = ["median", "q10", "q90"] as const;

type RecordValue = Record<string, unknown>;

export type CustomForecast = {
  readonly forecaster: string;
  readonly revision: string;
  readonly median: readonly number[];
  readonly q10: readonly number[];
  readonly q90: readonly number[];
};

/** A custom puzzle carried entirely by its share link. */
export type CustomPuzzle = {
  readonly v: 1;
  readonly source: string;
  readonly label: string;
  readonly unit: string;
  readonly visible: readonly number[];
  readonly actual: readonly number[];
  readonly typicalMove: number;
  readonly yDomain: readonly [number, number];
  readonly ai: CustomForecast;
};

function record(value: unknown): RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Expected an object.");
  return value as RecordValue;
}

function keys(value: RecordValue, expected: readonly string[]): void {
  if (Object.keys(value).length !== expected.length || expected.some((key) => !(key in value)))
    throw new Error("Unexpected or missing fields.");
}

function text(value: unknown, max = Number.POSITIVE_INFINITY, min = 1): string {
  if (typeof value !== "string" || value.length < min || value.length > max)
    throw new Error("Invalid text field.");
  return value;
}

function numeric(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > MAX_ABSOLUTE_VALUE)
    throw new Error("Invalid numeric field.");
  return value;
}

function numbers(value: unknown, length: number): number[] {
  if (!Array.isArray(value) || value.length !== length) throw new Error("Invalid array length.");
  return Array.from(value, numeric);
}

/** Restore URL-safe base64 to the padded alphabet the platform decoder expects. */
function paddedBase64(encoded: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error("Invalid custom payload.");
  const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
  return base64 + "=".repeat((4 - (base64.length % 4)) % 4);
}

/** Decode a share-link payload; a link longer than the limit is rejected before decoding. */
export function decodeCustomPayload(encoded: string): unknown {
  if (typeof encoded !== "string" || encoded.length === 0 || encoded.length > MAX_ENCODED_LENGTH)
    throw new Error("Invalid custom payload.");
  let json: string;
  try {
    json = new TextDecoder().decode(
      Uint8Array.from(atob(paddedBase64(encoded)), (char) => char.charCodeAt(0)),
    );
  } catch {
    throw new Error("Invalid custom payload.");
  }
  try {
    return JSON.parse(json);
  } catch {
    throw new Error("Invalid custom payload.");
  }
}

/** The forecast shape is shared with daily puzzles; keep the same seven-day quantile order. */
function forecast(value: unknown, forecaster: string, revision: string): CustomForecast {
  const input = record(value);
  keys(input, FORECAST_KEYS);
  const median = numbers(input.median, HORIZON);
  const q10 = numbers(input.q10, HORIZON);
  const q90 = numbers(input.q90, HORIZON);
  for (let day = 0; day < HORIZON; day += 1) {
    const lower = q10[day];
    const middle = median[day];
    const upper = q90[day];
    if (
      lower === undefined ||
      middle === undefined ||
      upper === undefined ||
      lower > middle ||
      middle > upper
    )
      throw new Error("Crossed forecast quantiles.");
  }
  return { forecaster, revision, median, q10, q90 };
}

/**
 * Validate a custom payload and compute its geometry from the series.
 * A link carries no chart domain, so it cannot smuggle one that disagrees with its values.
 */
export function parseCustomPuzzle(value: unknown): CustomPuzzle {
  const input = record(value);
  keys(input, KEYS);
  if (input.v !== 1) throw new Error("Unsupported custom payload version.");
  const source = text(input.source, MAX_SOURCE_LENGTH, 0);
  const label = text(input.label, MAX_LABEL_LENGTH);
  const unit = text(input.unit, MAX_UNIT_LENGTH, 0);
  const visible = numbers(input.visible, VISIBLE_DAYS);
  const actual = numbers(input.actual, HORIZON);
  const ai = forecast(input.ai, text(input.model, MAX_LABEL_LENGTH), text(input.revision));
  const lowest = Math.min(...visible);
  const highest = Math.max(...visible);
  // A flat series still needs a domain with height to draw in.
  const padding = DOMAIN_PADDING * (highest - lowest) || 1;
  const yDomain = chartYDomain([lowest - padding, highest + padding], visible, {
    lower: ai.q10,
    upper: ai.q90,
  });
  return {
    v: 1,
    source,
    label,
    unit,
    visible,
    actual,
    typicalMove: typicalMove(visible),
    yDomain,
    ai,
  };
}
