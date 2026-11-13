import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import models from "../../../pipeline/forecastle_pipeline/models.lock.json";
import constants from "../../../scoring/constants.json";
import { howSections } from "../../src/ui/how";

const sections = howSections();
const byId = new Map(sections.map((section) => [section.id, section]));

function section(id: string) {
  const found = byId.get(id);
  if (!found) throw new Error(`Missing ${id} section.`);
  return found;
}

test("the page explains each part in its own section", () => {
  expect(sections.map(({ id }) => id)).toEqual([
    "closeness",
    "coverage",
    "crps",
    "k",
    "ai",
    "sealing",
    "data",
    "run",
    "teacher",
  ]);
});

test("k and its interval come from the scoring constants", () => {
  const [low, high] = constants.kInterval;
  if (low === undefined || high === undefined) throw new Error("Missing k interval.");
  const text = section("k").paragraphs.join(" ");
  expect(text).toContain(constants.k.toFixed(2));
  expect(text).toContain(low.toFixed(2));
  expect(text).toContain(high.toFixed(2));
});

test("the AI section names the pinned model and revision", () => {
  const model = models["amazon/chronos-2"];
  const ai = section("ai");
  expect(ai.paragraphs.join(" ")).toContain("amazon/chronos-2");
  expect(ai.paragraphs.join(" ")).toContain(model.revision);
  expect(ai.link?.href).toMatch(/forecasters\/chronos2\.py$/u);
});

test("the run section carries the install line, both commands and the data notice", () => {
  const run = section("run");
  const code = run.steps?.map((step) => step.code) ?? [];
  expect(code).toContain("curl -LsSf https://astral.sh/uv/install.sh | sh");
  expect(code).toContain("uvx --torch-backend cpu forecastle-pipeline custom my.csv");
  expect(code).toContain("uvx --torch-backend cpu forecastle-pipeline custom --wikipedia Pumpkin");
  expect(run.paragraphs.join(" ")).toContain("Open-Meteo data is for non-commercial use.");
});

test("the data section links to the data page", () => {
  expect(section("data").link).toEqual({ href: "#/data", label: "Your data" });
});

test("no copy string is empty", () => {
  const text = sections.flatMap((item) => [
    item.title,
    ...item.paragraphs,
    ...(item.steps?.flatMap((step) => [step.text, step.code]) ?? []),
    ...(item.figure
      ? [
          item.figure.title,
          item.figure.description,
          item.figure.caption,
          ...Object.values(item.figure.labels),
        ]
      : []),
    ...(item.link ? [item.link.label] : []),
  ]);
  for (const value of text) {
    expect(value.trim()).not.toBe("");
  }
});

test("the print stylesheet hides the AI, sealing, data and run sections", () => {
  const css = readFileSync(new URL("../../src/styles.css", import.meta.url), "utf8");
  const print = css.slice(css.indexOf("@media print"));
  for (const selector of [".how-ai", ".how-sealing", ".how-data", ".how-run"]) {
    expect(print).toContain(selector);
  }
  expect(print).toContain("display: none");
});
