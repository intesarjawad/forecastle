import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

test("private custom output is ignored by Git and formatting", () => {
  assert.equal(
    execFileSync("git", ["check-ignore", "forecastle-custom/puzzle.json"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    "forecastle-custom/puzzle.json",
  );
  const directory = mkdtempSync(join(tmpdir(), "forecastle-format-"));
  try {
    copyFileSync(join(root, "biome.json"), join(directory, "biome.json"));
    mkdirSync(join(directory, "forecastle-custom"));
    writeFileSync(join(directory, "forecastle-custom/puzzle.json"), '{"visible":[ 1,2 ,3]}\n');
    execFileSync(join(root, "node_modules/.bin/biome"), ["ci", "."], {
      cwd: directory,
      encoding: "utf8",
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
