// Renders the link-unfurl image and the repository's social preview: the marked pair of
// columns from docs/stills/card.png, with the verdict set beside it on the same paper.
// Run `node scripts/record_demo.ts` first, then `node scripts/render_cards.ts`.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import constants from "../scoring/constants.json" with { type: "json" };
import { closeness, coverage } from "../site/src/core/scoring.ts";
import type { Interval } from "../site/src/core/types.ts";
import { reason, verdict } from "../site/src/core/verdict.ts";
import { answer, expected, puzzle } from "../site/tests/e2e/recorded-play.ts";

const root = new URL("../", import.meta.url).pathname;
const SIZES = [
  { file: "docs/social-preview.png", width: 1280, height: 640 },
  { file: "site/public/og.png", width: 1200, height: 630 },
] as const;

const stylesheet = await readFile(join(root, "site/src/styles.css"), "utf8");
const tokens = /:root\s*\{[^{}]*\}/u.exec(stylesheet)?.[0];
if (!tokens) throw new Error("site/src/styles.css has no :root token block.");
const card = pathToFileURL(join(root, "docs/stills/card.png")).href;
const font = (weight: number) =>
  pathToFileURL(
    join(
      root,
      `node_modules/@fontsource/shippori-mincho/files/shippori-mincho-latin-${weight}-normal.woff2`,
    ),
  ).href;
// The words are the game's own: the recorded play the card shows, scored here by the same
// code the page scores it with.
const side = (path: readonly number[], interval: Interval) => ({
  closeness: closeness(path, answer.actual, puzzle.typicalMove, constants.k),
  coverage: coverage(interval, answer.actual),
});
const band = expected.you.bandHalfWidth;
const you = side(expected.you.path, {
  lower: expected.you.path.map((value) => value - band),
  upper: expected.you.path.map((value) => value + band),
});
const ai = side(puzzle.ai.median, { lower: puzzle.ai.q10, upper: puzzle.ai.q90 });
if (you.closeness !== expected.you.closeness || ai.closeness !== expected.ai.closeness)
  throw new Error(`The recorded play scores ${you.closeness} to ${ai.closeness} now.`);

// A feed shows the card at about a third of its size, so nothing on it is set below 26 px.
const template = `<!doctype html>
<meta charset="utf-8">
<style>
${tokens}
@font-face { font-family: "Shippori Mincho"; src: url("${font(400)}"); font-weight: 400; }
@font-face { font-family: "Shippori Mincho"; src: url("${font(800)}"); font-weight: 800; }
body {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 40px;
  block-size: 100vh;
  margin: 0;
  padding: 0 56px 0 24px;
  box-sizing: border-box;
  overflow: hidden;
  background: var(--washi);
  color: var(--sumi);
  font-family: var(--font-text);
  position: relative;
}
body::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  background-image: var(--paper-grain);
  opacity: var(--grain-opacity);
}
/* The crop's own paper fades into the card's, so its edge never shows as a pasted print. */
img {
  display: block;
  block-size: calc(100vh - 16px);
  mask-image: linear-gradient(to right, transparent, black 6%, black 94%, transparent),
    linear-gradient(transparent, black 4%, black 96%, transparent);
  mask-composite: intersect;
}
p { margin: 0; }
.name { font-family: var(--font-display); font-weight: 800; font-size: 34px; }
.verdict { margin-block: 28px 16px; font-size: 60px; line-height: 1.08; text-wrap: balance; }
.reason { font-size: 30px; }
.series { margin-block-start: 36px; color: var(--print); font-size: 26px; }
</style>
<img src="${card}" alt="">
<div>
  <p class="name">Forecastle</p>
  <p class="verdict">${verdict(you, ai)}</p>
  <p class="reason">${reason(you, ai)}</p>
  <p class="series">${puzzle.label}, a week ahead</p>
</div>
`;

const directory = await mkdtemp(join(tmpdir(), "forecastle-cards-"));
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const html = join(directory, "card.html");
  await writeFile(html, template);
  for (const { file, width, height } of SIZES) {
    await page.setViewportSize({ width, height });
    await page.goto(pathToFileURL(html).href);
    if (!(await page.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)))
      throw new Error("docs/stills/card.png is missing; run scripts/record_demo.ts first.");
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(root, file) });
    console.log(`${file}: ${width}x${height}`);
  }
} finally {
  await browser.close();
  await rm(directory, { recursive: true, force: true });
}
