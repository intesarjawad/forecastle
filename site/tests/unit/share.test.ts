import { expect, test } from "vitest";
import { shareText } from "../../src/core/share";
import type { Cell } from "../../src/core/types";

const result = {
  you: 82,
  ai: 64,
  youCells: ["green", "green", "green", "yellow", "green", "white", "white"] as Cell[],
  aiCells: ["green", "yellow", "white", "white", "white", "white", "white"] as Cell[],
  bandCaught: 5,
};
const grid =
  "You \u25CE\u25CE\u25CE\u25CB\u25CE\u25CC\u25CC\nAI  \u25CE\u25CB\u25CC\u25CC\u25CC\u25CC\u25CC\nBand caught 5/7";

test("formats the daily share text exactly", () => {
  const output = shareText({ ...result, kind: "daily", number: 41, link: "https://example.org/" });
  expect(output).toBe(`Forecastle #41: You 82, AI 64\n${grid}\nhttps://example.org/`);
  expect(Array.from(output.split("\n")[1]?.slice(4) ?? "", (cell) => cell.codePointAt(0))).toEqual([
    0x25ce, 0x25ce, 0x25ce, 0x25cb, 0x25ce, 0x25cc, 0x25cc,
  ]);
  expect(output).toMatch(/^Forecastle #\d+: You \d+, AI \d+\n/);
  expect(output.match(/\d+/g)).toEqual(["41", "82", "64", "5", "7"]);
  expect(output).not.toContain("·");
});

test("formats custom share text and preserves its link", () => {
  const link = "https://example.org/#/c/aB_09-xyz";
  const output = shareText({ ...result, kind: "custom", link });
  expect(output).toBe(`Forecastle custom: You 82, AI 64\n${grid}\n${link}`);
  expect(output.split("\n").at(-1)).toBe(link);
  expect(output).not.toContain("·");
});
