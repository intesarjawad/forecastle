import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const html = readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
const source = /<script id="puzzle-startup">([\s\S]*?)<\/script>/u.exec(html)?.[1];
assert.ok(source);

function startup(hash, fetch) {
  const window = {};
  runInNewContext(source, {
    window,
    location: { hash, href: `https://example.test/forecastle/${hash}` },
    fetch,
    Response,
    URL,
  });
  return window.forecastleInitialPuzzle;
}

test("the initial puzzle body is read while game code loads and preserves HTTP status", async () => {
  for (const status of [200, 404]) {
    const original = new Response('{"id":"2026-10-21"}', { status });
    const initial = startup("#/p/2026-10-21", async (url, options) => {
      assert.equal(url, "https://example.test/forecastle/puzzles/2026-10-21/puzzle.json");
      assert.equal(options.priority, "high");
      return original;
    });
    const response = await initial.response;
    assert.equal(original.bodyUsed, true);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { id: "2026-10-21" });
  }
});

test("a failed initial request remains an ordinary network error", async () => {
  const initial = startup("#/p/2026-10-21", async () => {
    throw new TypeError("Offline");
  });
  assert.equal((await initial.response).type, "error");
});

test("non-game routes and invalid calendar dates do not request a daily puzzle", () => {
  for (const hash of ["#/live", "#/data", "#/c/value", "#/p/2026-02-30"]) {
    const initial = startup(hash, () => {
      assert.fail("Unexpected puzzle request");
    });
    assert.equal(initial, undefined);
  }
});
