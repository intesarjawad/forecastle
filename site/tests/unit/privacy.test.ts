import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { messages, PRIVACY_URL } from "../../src/ui/messages";

const notice = readFileSync(new URL("../../../docs/privacy.md", import.meta.url), "utf8");
const flat = notice.replaceAll(/\s+/gu, " ");

test("the site links to the published copy of the notice", () => {
  expect(PRIVACY_URL).toMatch(
    /^https:\/\/github\.com\/[^/]+\/forecastle\/blob\/main\/docs\/privacy\.md$/u,
  );
  expect(messages.nav.privacy).toBe("Privacy");
  expect(messages.data.privacy).toBe("Read the privacy notice");
});

test("the notice states the guarantees the data page and the Worker rely on", () => {
  for (const phrase of [
    "No IP address is stored",
    "#/data",
    "there is no share ping",
    "no cookies",
    "URL fragment",
    "changes with every puzzle",
  ]) {
    expect(flat).toContain(phrase);
  }
});

test("the notice names every storage key and the history file name", () => {
  for (const key of [
    "forecastle.v1.plays",
    "forecastle.v1.secret",
    "forecastle.v1.crowdOptOut",
    "forecastle-history-YYYY-MM-DD.json",
  ]) {
    expect(notice).toContain(`\`${key}\``);
  }
});

test("the notice lists each field the lock sends", () => {
  for (const field of ["puzzleId", "clientId", "path", "halfWidth", "msToLock"]) {
    expect(notice).toContain(`- \`${field}\``);
  }
});
