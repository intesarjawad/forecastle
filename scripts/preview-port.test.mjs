import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

for (const path of ["../playwright.config.ts", "./lighthouse.mjs"]) {
  test(`${path} rejects invalid preview ports before starting a server`, () => {
    for (const port of ["43981; invalid", "0", "65536", "1.5"]) {
      const result = spawnSync(process.execPath, [new URL(path, import.meta.url).pathname], {
        env: { ...process.env, FORECASTLE_PORT: port },
        encoding: "utf8",
      });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /FORECASTLE_PORT must be an integer from 1 to 65535/u);
    }
  });
}
