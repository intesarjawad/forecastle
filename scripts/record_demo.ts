// Records the README demo from the built site: one daily lesson, brushed by a scripted
// finger, handed in and corrected. Writes docs/demo.gif, docs/demo.mp4 and the stills in docs/stills/.
// Run with `node scripts/record_demo.ts`; needs ffmpeg on PATH.
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { chromium, type Page } from "@playwright/test";
import livePuzzle1 from "../benchmark/fixtures/live/fixture/1/puzzle.json" with { type: "json" };
import livePuzzle2 from "../benchmark/fixtures/live/fixture/2/puzzle.json" with { type: "json" };
import livePuzzle3 from "../benchmark/fixtures/live/fixture/3/puzzle.json" with { type: "json" };
import game from "../data/game.json" with { type: "json" };
import { answer, expected, puzzle } from "../site/tests/e2e/recorded-play.ts";

const run = promisify(execFile);
const root = new URL("../", import.meta.url).pathname;
const origin = "http://127.0.0.1:43875";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const VIEWPORT = { width: 390, height: 844 };
// A desk short enough that the sheet takes its shortest rows, so the marked pair comes out
// about as tall as a link card and is shown there near its own size.
const CARD_VIEWPORT = { width: 1440, height: 676 };
const SCALE = 2;
const FPS = 30;
const GIF_LIMIT_BYTES = 4 * 1024 * 1024;
const DEMO_FRAMES = 10 * FPS;
// A finger reports about 60 moves a second, so two land in every 30 fps frame.
const MOVES_PER_FRAME = 2;
const MOVES_PER_DAY = 16;
const IDLE_HOLD_FRAMES = Math.round(0.7 * FPS);
const BAND_HOLD_FRAMES = Math.round(0.25 * FPS);
// Long enough for the press on "Hand it in" to register on screen.
const TAP_FRAMES = Math.round(0.15 * FPS);
// The correction takes 2.45 s; the rest lets the ink settle before the poster frame.
const POSTER_FRAME_AFTER_LOCK = 3 * FPS;
// The recorded play's 3.4 °C band rounds to the slider's nearest step that still catches all seven days.
const BAND_HALF_WIDTH = 1.5;
// Room below the last kept element, short of the next line of text.
const CARD_MARGIN = 6;
// Paper kept round the card's crop of the sheet, short of the masthead above it.
const CARD_PAPER = 8;
// The card keeps only the two marked columns, so the thread to the given weeks would end in
// mid-air; the column names are set large enough to survive a feed's thumbnail.
// Rows a little shorter than the page's own pack the week into the card's height, so the
// card can show the marks larger than life.
const CARD_STYLE = [
  ".lesson { --row: 36px; }",
  ".column-head, .head-you { font-size: 20px; }",
  ".sheet-link, .sheet-start { display: none; }",
].join("\n");

const LIVE_ROUND = {
  id: "live-2026-11-09",
  charts: 3,
  opensUtc: livePuzzle1.opensUtc,
  cutoffUtc: livePuzzle1.cutoffUtc,
  resolvesUtc: livePuzzle1.resolvesUtc,
  resolved: false,
};

/** A finger-sized ring that follows the pointer, so the recording shows where the touch is. */
function showFinger() {
  const finger = document.createElement("div");
  finger.setAttribute("aria-hidden", "true");
  Object.assign(finger.style, {
    position: "fixed",
    insetBlockStart: "0",
    insetInlineStart: "0",
    inlineSize: "36px",
    blockSize: "36px",
    marginBlockStart: "-18px",
    marginInlineStart: "-18px",
    border: "2px solid rgb(0 0 0 / 0.55)",
    borderRadius: "50%",
    background: "rgb(0 0 0 / 0.12)",
    pointerEvents: "none",
    zIndex: "10",
    opacity: "0",
  });
  const place = (event: PointerEvent) => {
    finger.style.opacity = "1";
    finger.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
  };
  addEventListener("pointermove", place, true);
  addEventListener("pointerdown", (event) => {
    place(event);
    finger.style.background = "rgb(0 0 0 / 0.28)";
  });
  // A lifted finger leaves the frame, so it never covers the result it just revealed.
  addEventListener("pointerup", () => {
    finger.style.background = "rgb(0 0 0 / 0.12)";
    finger.style.opacity = "0";
  });
  addEventListener("DOMContentLoaded", () => document.body.append(finger));
}

async function serveFixtures(page: Page) {
  await page.clock.setFixedTime(new Date(`${game.launchDate}T12:00:00Z`));
  await page.route("**/puzzles/index.json", (route) =>
    route.fulfill({
      json: {
        launchDate: game.launchDate,
        puzzles: [
          { id: puzzle.id, number: puzzle.number, kind: "historical", label: puzzle.label },
        ],
        live: [LIVE_ROUND],
      },
    }),
  );
  await page.route("**/puzzles/*/puzzle.json", (route) => route.fulfill({ json: puzzle }));
  await page.route("**/puzzles/*/answer.json", (route) => route.fulfill({ json: answer }));
  const livePuzzles = [livePuzzle1, livePuzzle2, livePuzzle3];
  await page.route(`**/live/${LIVE_ROUND.id}/*/puzzle.json`, (route) => {
    const number = Number(new URL(route.request().url()).pathname.split("/").at(-2));
    return route.fulfill({ json: livePuzzles[number - 1] });
  });
}

async function centre(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`Missing ${selector}.`);
  return { box, x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Screen recording in headless Chromium captures CSS pixels, not the 2x device pixels, so
 * the demo is filmed one screenshot per frame. The page runs on an installed clock that
 * advances exactly one frame between shots, which also keeps the reveal's timing exact.
 */
function camera(page: Page, directory: string) {
  let frame = 0;
  const elapsedMs = (count: number) => Math.round((count * 1000) / FPS);
  return {
    get frame() {
      return frame;
    },
    async shoot(count = 1) {
      for (let shot = 0; shot < count; shot += 1) {
        await page.clock.runFor(elapsedMs(frame + 1) - elapsedMs(frame));
        const name = `${String(frame).padStart(4, "0")}.png`;
        await page.screenshot({ path: join(directory, name) });
        frame += 1;
      }
    },
  };
}
type Camera = ReturnType<typeof camera>;

async function glide(
  page: Page,
  film: Camera,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  for (let step = 1; step <= MOVES_PER_DAY; step += 1) {
    const fraction = step / MOVES_PER_DAY;
    await page.mouse.move(from.x + (to.x - from.x) * fraction, from.y + (to.y - from.y) * fraction);
    if (step % MOVES_PER_FRAME === 0) await film.shoot();
  }
}

/**
 * The recorded play: every day's corner is a pointer sample, so each day lands on its value.
 * Days run down the player's column; values run across it inside a margin of a tenth each side.
 */
async function drawWeek(page: Page, film: Camera) {
  const { box } = await centre(page, ".draw-region");
  const [lower, upper] = puzzle.yDomain;
  if (lower === undefined || upper === undefined) throw new Error("Missing recorded domain.");
  const inset = box.width * 0.1;
  const corners = [puzzle.visible.at(-1) ?? 0, ...expected.you.path].map((value, day) => ({
    x: box.x + inset + ((box.width - 2 * inset) * (value - lower)) / (upper - lower),
    y: box.y + (box.height * day) / 7 + (day === 0 ? 1 : day === 7 ? 0.5 : 0),
  }));
  const [first] = corners;
  if (!first) throw new Error("Missing stroke start.");
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  await film.shoot();
  for (const [index, corner] of corners.slice(1).entries()) {
    await glide(page, film, corners[index] ?? first, corner);
  }
  await page.mouse.up();
  await film.shoot();
}

async function widenBand(page: Page, film: Camera) {
  const slider = page.getByRole("slider", { name: "How sure are you?" });
  const box = await slider.boundingBox();
  if (!box) throw new Error("Missing band slider.");
  const value = async (name: string) => Number(await slider.getAttribute(name));
  const [min, max, now] = await Promise.all([value("min"), value("max"), value("value")]);
  // The thumb is 24 px wide, so its centre travels 12 px inside each end of the track.
  const at = (band: number) => ({
    x: box.x + 12 + ((box.width - 24) * (band - min)) / (max - min),
    y: box.y + box.height / 2,
  });
  const start = at(now);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await film.shoot();
  await glide(page, film, start, at(BAND_HALF_WIDTH));
  await page.mouse.up();
  if ((await slider.inputValue()) !== String(BAND_HALF_WIDTH))
    throw new Error(`The band slider stopped at ${await slider.inputValue()}.`);
}

async function startPreview() {
  await run("npm", ["run", "build", "-w", "site"], { cwd: root });
  const preview = spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "preview", "site", "--host", "127.0.0.1", "--port", "43875"],
    { cwd: root, stdio: "ignore" },
  );
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (preview.exitCode !== null) throw new Error("Preview exited before becoming ready.");
    try {
      if ((await fetch(origin, { signal: AbortSignal.timeout(500) })).ok) return preview;
    } catch {
      // Not listening yet.
    }
    await delay(100);
  }
  preview.kill("SIGTERM");
  throw new Error("Preview did not become ready.");
}

async function ffmpeg(...args: string[]) {
  await run("ffmpeg", ["-y", "-loglevel", "error", ...args], { cwd: root });
}

const stills = join(root, "docs/stills");
await mkdir(stills, { recursive: true });
const framesDirectory = await mkdtemp(join(tmpdir(), "forecastle-frames-"));
const preview = await startPreview();
// Headless Chromium renders WebGL in software unless pointed at the GPU, and the ink's bleed
// stays off on a software renderer; on a Mac, Metal gives the take its wet edges.
const browser = await chromium.launch({
  args: process.platform === "darwin" ? ["--use-angle=metal", "--enable-gpu"] : [],
});
try {
  const page = await browser.newPage({
    viewport: VIEWPORT,
    deviceScaleFactor: SCALE,
    timezoneId: "UTC",
  });
  await page.clock.install({ time: new Date(`${game.launchDate}T12:00:00Z`) });
  await page.addInitScript(showFinger);
  await serveFixtures(page);
  await page.goto(origin);
  await page.getByRole("slider", { name: "Day 1" }).waitFor();
  const shown = await page.locator("#match-number").textContent();
  if (shown !== `No. ${puzzle.number}`) throw new Error(`The sheet reads "${shown}".`);
  await page.evaluate(() => document.fonts.ready);
  // An installed clock still follows the wall clock, so it is paused: a slow screenshot must
  // not let the correction run ahead of the frames.
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  const film = camera(page, framesDirectory);

  await film.shoot(IDLE_HOLD_FRAMES);
  await drawWeek(page, film);
  await widenBand(page, film);
  await film.shoot(BAND_HOLD_FRAMES);
  await page.screenshot({ path: join(stills, "drawn.png") });
  const lock = await centre(page, ".lock-button");
  await page.mouse.move(lock.x, lock.y);
  await page.mouse.down();
  await film.shoot(TAP_FRAMES);
  await page.mouse.up();
  const posterFrame = film.frame + POSTER_FRAME_AFTER_LOCK;
  await film.shoot(posterFrame - film.frame);
  await page.locator("#scoreline[data-reveal='complete']").waitFor();
  await page.screenshot({ path: join(stills, "revealed.png") });
  if (film.frame > DEMO_FRAMES) throw new Error(`The take runs ${film.frame} frames.`);
  await film.shoot(DEMO_FRAMES - film.frame);

  // The GIF is the signature frame: the sheet down to Share and the streak line under it,
  // all of which a phone shows without scrolling.
  const top = await page.locator(".series").boundingBox();
  const bottom = await page.locator(".record-line").first().boundingBox();
  if (!top || !bottom) throw new Error("Missing the sheet's crop edges.");
  const end = bottom.y + bottom.height + CARD_MARGIN;
  if (end > VIEWPORT.height) throw new Error(`The streak line ends at ${end} px, below the fold.`);
  const cropY = Math.round(top.y * SCALE);
  const cropHeight = Math.round((end - top.y) * SCALE);

  await page.setViewportSize(CARD_VIEWPORT);
  await page.reload();
  await page.locator("#scoreline[data-reveal='complete']").waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.clock.runFor(3000);
  await page.addStyleTag({ content: CARD_STYLE });
  await page.clock.runFor(1000);
  // The card is the marked pair alone: the AI's column and yours, from their names down to
  // the written scores and the hanamaru. scripts/render_cards.ts sets the verdict beside it.
  const edges = await page.evaluate(() => {
    const boxes = [".head-ai", ".body-ai", ".head-you", ".body-you", ".score"].flatMap((selector) =>
      [...document.querySelectorAll(selector)].map((e) => e.getBoundingClientRect()),
    );
    // The score's row stretches to the verdict beside it; the petals reach this far below it.
    const petals = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--hanamaru-room"),
    );
    return {
      left: Math.min(...boxes.map((box) => box.left)) + scrollX,
      right: Math.max(...boxes.map((box) => box.right)) + scrollX,
      top: Math.min(...boxes.map((box) => box.top)) + scrollY,
      bottom: Math.max(...boxes.map((box) => box.bottom)) + scrollY + petals,
    };
  });
  await page.screenshot({
    path: join(stills, "card.png"),
    clip: {
      x: edges.left - CARD_PAPER,
      y: edges.top - CARD_PAPER,
      width: edges.right - edges.left + CARD_PAPER * 2,
      height: edges.bottom - edges.top + CARD_PAPER,
    },
    fullPage: true,
  });
  await page.close();

  const live = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: SCALE });
  await serveFixtures(live);
  await live.goto(`${origin}/#/live`);
  await live.locator(".live-card .chart-svg").first().waitFor();
  await live.evaluate(() => document.fonts.ready);
  await live.screenshot({ path: join(stills, "live.png") });

  const input = ["-framerate", String(FPS), "-i", join(framesDirectory, "%04d.png")];
  await ffmpeg(
    ...input,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "18",
    "-movflags",
    "+faststart",
    "docs/demo.mp4",
  );
  await ffmpeg(
    "-i",
    join(framesDirectory, `${String(posterFrame).padStart(4, "0")}.png`),
    "docs/stills/poster.png",
  );
  let gifBytes = Number.POSITIVE_INFINITY;
  for (const [fps, colours] of [
    [30, 128],
    [24, 128],
    [24, 96],
  ] as const) {
    await ffmpeg(
      ...input,
      "-vf",
      `crop=${VIEWPORT.width * SCALE}:${cropHeight}:0:${cropY},fps=${fps},split[s0][s1];[s0]palettegen=max_colors=${colours}[p];[s1][p]paletteuse=dither=bayer`,
      "docs/demo.gif",
    );
    gifBytes = (await stat(join(root, "docs/demo.gif"))).size;
    console.log(`docs/demo.gif: ${gifBytes} bytes at ${fps} fps, ${colours} colours`);
    if (gifBytes < GIF_LIMIT_BYTES) break;
  }
  if (gifBytes >= GIF_LIMIT_BYTES) throw new Error("docs/demo.gif stays over 4 MB.");
} finally {
  await browser.close();
  preview.kill("SIGTERM");
  await rm(framesDirectory, { recursive: true, force: true });
}
