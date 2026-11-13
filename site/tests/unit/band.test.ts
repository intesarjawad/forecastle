import { expect, test } from "vitest";
import { BAND_RANGE, bandValueText } from "../../src/ui/band";

test("the value text is the half-width in the puzzle's unit", () => {
  // 1 x 1.6 = 1.6; 2.5 x 1.2 = 3; 0.25 x 1.2 = 0.3; 8 x 1.2 = 9.6.
  expect(bandValueText(1, 1.6, "°C")).toBe("±1.6 °C");
  expect(bandValueText(2.5, 1.2, "°C")).toBe("±3 °C");
  expect(bandValueText(0.25, 1.2, "°C")).toBe("±0.3 °C");
  expect(bandValueText(8, 1.2, "°C")).toBe("±9.6 °C");
});

test("a unitless series has no trailing space", () => {
  expect(bandValueText(2, 1.5, "")).toBe("±3");
});

test("the slider runs from a quarter to eight typical moves in quarter steps from one", () => {
  expect(BAND_RANGE).toEqual({ min: 0.25, max: 8, step: 0.25, initial: 2 });
  expect((BAND_RANGE.max - BAND_RANGE.min) % BAND_RANGE.step).toBe(0);
  expect((BAND_RANGE.initial - BAND_RANGE.min) % BAND_RANGE.step).toBe(0);
});
