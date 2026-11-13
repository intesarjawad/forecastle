import { expect, test } from "vitest";
import {
  dateRange,
  labelledTicks,
  type SheetFrame,
  sheetGeometry,
  weekHeads,
  weeks,
} from "../../src/ui/sheet";

const visible = Array.from({ length: 28 }, (_, day) => day + 1);
const column = (x: number) => ({ x, y: 100, width: 100, height: 350 });
const desktop: SheetFrame = {
  width: 900,
  height: 600,
  columns: {
    w0: column(800),
    w1: column(650),
    w2: column(500),
    w3: column(350),
    you: column(200),
    ai: column(50),
  },
};
const phone: SheetFrame = {
  ...desktop,
  columns: { ...desktop.columns, w0: null, w1: null, w2: null },
};

test("the visible days split into four weeks, each carrying in the day before it", () => {
  const split = weeks(visible);
  expect(split.map((week) => week.values)).toEqual([
    [1, 2, 3, 4, 5, 6, 7],
    [8, 9, 10, 11, 12, 13, 14],
    [15, 16, 17, 18, 19, 20, 21],
    [22, 23, 24, 25, 26, 27, 28],
  ]);
  expect(split.map((week) => week.anchor)).toEqual([null, 7, 14, 21]);
  expect(() => weeks(visible.slice(1))).toThrow();
});

test("every column shares one value scale inside a tenth-of-a-column margin", () => {
  const geometry = sheetGeometry(desktop, [0, 40]);
  expect(geometry.phone).toBe(false);
  expect(geometry.scale).toBe(2);
  expect(geometry.x("you", 0)).toBe(210);
  expect(geometry.x("you", 40)).toBe(290);
  expect(geometry.x("w0", 20)).toBe(850);
  expect(geometry.y("ai", 0)).toBe(100);
  expect(geometry.y("ai", 7)).toBe(450);
  expect(geometry.value("you", geometry.x("you", 13.5))).toBeCloseTo(13.5);
  expect(geometry.day("you", geometry.y("you", 3.25))).toBeCloseTo(3.25);
});

test("on a phone the earlier weeks are written into the last week's column", () => {
  const geometry = sheetGeometry(phone, [0, 40]);
  expect(geometry.phone).toBe(true);
  expect(geometry.rect("w0")).toEqual(desktop.columns.w3);
  expect(geometry.x("w1", 10)).toBe(geometry.x("w3", 10));
});

test("week heads count days from today and never name the dates", () => {
  const heads = weekHeads("amazon/chronos-2");
  expect(heads.map(([column]) => column)).toEqual(["w0", "w1", "w2", "w3", "you", "ai"]);
  expect(heads[3]).toEqual(["w3", "−6 d to today", ""]);
  expect(heads[4]).toEqual(["you", "Your week", "+1 to +7 d"]);
  expect(heads[5]).toEqual(["ai", "The AI", "amazon/chronos-2"]);
});

test("a date range names the month once when both ends share it", () => {
  expect(dateRange("2026-05-07", "2026-05-13")).toBe("7 to 13 May");
  expect(dateRange("2026-12-29", "2027-01-04")).toBe("29 Dec to 4 Jan");
});

test("tick labels thin out until they clear each other, and short ones all stay", () => {
  expect(labelledTicks([10, 20, 30], 3)).toEqual([10, 20, 30]);
  // "1,600" is five characters, 35 px, against 200 units at 0.15 px each: 30 px apart.
  expect(labelledTicks([1600, 1800, 2000], 0.15)).toEqual([1600, 2000]);
  expect(labelledTicks([0, 1, 2, 3, 4], 2)).toEqual([0, 4]);
});
