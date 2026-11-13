import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const coreDirectory = fileURLToPath(new URL("../../src/core/", import.meta.url));
function violations(source: string): string[] {
  const patterns = [
    /\b(?:import|export)\s+(?:[^;]*?\s+from\s+)?["'](?:\.\.\/)+(?:ui|io)(?:\/|["'])/g,
    /\b(?:import|require)\s*\(\s*["'](?:\.\.\/)+(?:ui|io)(?:\/|["'])/g,
    /\b(?:document|window|fetch|localStorage)\b/g,
    /\bDate\s*\.\s*now\b/g,
  ];
  return patterns.flatMap((pattern) => Array.from(source.matchAll(pattern), (match) => match[0]));
}

test("core modules do not depend on I/O or UI", () => {
  const files = readdirSync(coreDirectory).filter((file) => file.endsWith(".ts"));
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    expect(violations(readFileSync(`${coreDirectory}/${file}`, "utf8")), file).toEqual([]);
  }
});

test.each([
  'import { chart } from "../ui/chart";',
  'export { load } from "../io/storage";',
  'import("../io/storage");',
  "document.body;",
  "window.location;",
  'fetch("/data");',
  'localStorage.getItem("key");',
  "Date.now();",
])("detects forbidden core dependency: %s", (source) => {
  expect(violations(source)).not.toEqual([]);
});
