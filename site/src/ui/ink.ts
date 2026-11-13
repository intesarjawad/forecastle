import type { Cell } from "../core/types";
import {
  brush,
  circlePath,
  downward,
  hanamaruPath,
  numeralBox,
  numeralStrokes,
  type Point,
  ribbon,
  ribbonOutline,
  ribbonPath,
  turning,
} from "./brush";
import { COLUMNS, type Column, type Rect, type SheetGeometry, type Week } from "./sheet";

/** How far each part of the teacher's correction has been written, each from 0 to 1. */
export type Correction = {
  readonly real: readonly [number, number];
  readonly marks: readonly (readonly [number, number])[];
  readonly scores: number;
  readonly circle: number;
};

export type Lesson = {
  readonly actual: readonly number[];
  /** The written weeks the teacher marks: the player's path and the copy's median. */
  readonly paths: { readonly you: readonly number[]; readonly ai: readonly number[] };
  readonly cells: { readonly you: readonly Cell[]; readonly ai: readonly Cell[] };
  readonly winner: "you" | "ai" | null;
  readonly scores: { readonly you: number; readonly ai: number };
  /** Where each score is written, in sheet pixels, measured when painted. */
  readonly boxes: () => { readonly you: Rect; readonly ai: Rect } | null;
};

type Player =
  | { readonly kind: "none" }
  | { readonly kind: "raw"; readonly points: readonly Point[] }
  | { readonly kind: "path"; readonly values: readonly number[] };

/** What the bleed engine is told after a repaint: new ink to add, or a sheet to start again. */
export type InkChange = { readonly sumi?: "add" | "reset"; readonly shu?: "add" | "reset" };
export type InkEngine = {
  readonly changed: (change: InkChange) => void;
  /** With `keep`, the sheet only changed height below its ink, and the bleed carries on. */
  readonly resize: (keep?: boolean) => void;
  readonly destroy: () => void;
};

const GIVEN_DENSITY = 0.82;
const WASH_DENSITY = 0.34;
// The band is drawn at its true width with a feathered edge: the layers spread evenly either
// side of the band's edge, so the wash is half as dark exactly where the band ends.
const WASH_LAYERS = [1.25, 1.15, 1.05, 0.95, 0.85, 0.75];
/** How far, in pixels, the wash takes to fade in at the top and out at the foot. */
const WASH_END = 12;
const CORE_DENSITY = 0.95;
const THROUGH_DENSITY = 0.16;
/** The teacher's fine brush for day marks, and the hairline of paper where vermilion crosses sumi. */
const MARK_WIDTH = 1.5;
const PAPER_GAP = 1.5;
/** The sumi brush's body: wide enough to read on a phone, a share of the column on a desk. */
const sumiLine = (g: SheetGeometry) => Math.max(5, g.rect("you").width * 0.07);

/**
 * The day marks' rings. The inner ring of ◎ leaves at least 3 px of paper beside the sumi
 * body on every day, so the stroke shows through it as a line and never fills it black; the
 * outer ring keeps a clear gap outside it.
 */
function markRadii(g: SheetGeometry) {
  const row = g.rect("you").height / 7;
  const inner = sumiLine(g) / 2 + 3 + MARK_WIDTH;
  const radius = Math.max(5, Math.min(row * 0.15, g.rect("you").width * 0.085), inner + 5);
  return { radius, inner };
}

/** A mark drawn by the teacher's fine brush, as one ring's outline in SVG path data. */
function ringData(cx: number, cy: number, radius: number, seed: number, sweep: number) {
  const outline = ribbonOutline(circlePath(cx, cy, radius, seed, sweep), {
    width: MARK_WIDTH,
    seed: seed + 11,
    profile: even,
  });
  return outline ? `M${outline.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L")}Z` : "";
}

/** Where a loaded brush skips along its own edge on the paper's tooth, in pixels on and off. */
const TOOTH = [1.2, 2.6, 0.8, 1.7, 2.1, 3.4, 0.9, 2.2];

/** Bite the paper's tooth out of a filled stroke's edge, so the vermilion never ends in a vector line. */
function tooth(c: CanvasRenderingContext2D, outline: Path2D) {
  c.save();
  c.globalCompositeOperation = "destination-out";
  c.globalAlpha = 0.6;
  c.lineWidth = 1;
  c.setLineDash(TOOTH);
  c.stroke(outline);
  c.restore();
}

/** One stroke of the teacher's, traced only when it is needed. */
type Stroke = {
  readonly key: string;
  readonly points: () => Point[];
  readonly width: number;
  readonly upto: number;
  readonly seed: number;
  readonly profile?: (at: number, total: number) => number;
};

/** A fine brush holds one even width, pressed a little where it lands and lifted at the end. */
/** A hand writing a figure presses where it lands, eases through the stroke and lifts. */
const hand = (at: number, total: number) =>
  (0.7 + 0.5 * Math.exp(-at / 5) + 0.3 * Math.sin((Math.PI * at) / total)) *
  Math.min(1, 0.25 + (0.75 * (total - at)) / 8);

const even = (at: number, total: number) =>
  (1 + 0.25 * Math.max(0, 1 - at / 4)) * Math.min(1, 0.35 + (0.65 * (total - at)) / 8);

/**
 * The teacher's stroke down a column: pressed where the brush lands on today, swelling where
 * the hand slows on a turn, and lifting into a flick at the seventh day.
 */
function shuStroke(points: readonly Point[], width: number) {
  const turn = turning(points);
  return (upto: number) =>
    ribbonPath(points, {
      width,
      seed: 211,
      upto,
      profile: (at, total) =>
        // A rounded head, as a loaded brush lands, never a square cut.
        Math.sqrt(1 - (1 - Math.min(1, at / (width * 0.45))) ** 2) *
        (1 + 0.8 * Math.max(0, 1 - at / 14) ** 1.5) *
        (0.75 + 0.5 * turn(at)) *
        Math.max(0.12, Math.min(1, (total - at) / (total * 0.14)) ** 0.8),
    });
}

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/** A given week from its first day to its seventh, so every week starts at the same height. */
function weekPoints(geometry: SheetGeometry, column: Column, week: Week): Point[] {
  return week.values.map((value, index) => [
    geometry.x(column, value),
    geometry.y(column, index + 1),
  ]);
}

function copyOf(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement("canvas");
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext("2d")?.drawImage(canvas, 0, 0);
  return copy;
}

/**
 * Transparent canvases above the printed sheet: sumi, the teacher's vermilion strokes, and
 * the teacher's marks. Sumi and vermilion are the finished picture when WebGL is missing or
 * motion is reduced; otherwise they are the deposit the bleed engine soaks into the paper.
 * The marks are written with a fine brush on paper that has dried, so they never bleed.
 */
export function createInk(
  host: HTMLElement,
  colours: { readonly sumi: string; readonly shu: string },
) {
  const sumi = document.createElement("canvas");
  const shu = document.createElement("canvas");
  const marks = document.createElement("canvas");
  for (const canvas of [sumi, shu, marks]) {
    canvas.className = "ink-layer";
    canvas.setAttribute("aria-hidden", "true");
  }
  shu.classList.add("ink-shu");
  marks.classList.add("ink-marks");
  host.append(sumi, shu, marks);
  let geometry: SheetGeometry | null = null;
  let given: readonly Week[] = [];
  let start = 0;
  let halfWidth = 0;
  let player: Player = { kind: "none" };
  let lesson: Lesson | null = null;
  let correction: Correction | null = null;
  let size = { width: 0, height: 0, ratio: 1, strokeHeight: 0 };
  let engine: InkEngine | null = null;
  let laid = "";
  // The sumi as brushed, before any cut for the vermilion, so each repaint cuts it afresh.
  let uncut: HTMLCanvasElement | null = null;
  // The outline of the player's sumi core, so the teacher's vermilion stroke can part from it.
  let core: Path2D | null = null;

  const context = (canvas: HTMLCanvasElement) => {
    const drawing = canvas.getContext("2d");
    if (!drawing) throw new Error("Ink needs a 2D canvas.");
    drawing.setTransform(size.ratio, 0, 0, size.ratio, 0, 0);
    drawing.clearRect(0, 0, size.width, size.height);
    return drawing;
  };

  const paintSumi = () => {
    uncut = null;
    core = null;
    if (!geometry) return;
    const g = geometry;
    const c = context(sumi);
    c.strokeStyle = colours.sumi;
    const line = sumiLine(g);
    given.forEach((week, index) => {
      // On a phone the earlier weeks show through the last one, the way writing on the sheets
      // beneath shows through thin paper: the same brush, faint and narrow.
      const through = g.phone && index < 3;
      brush(c, weekPoints(g, through ? "w3" : (`w${index}` as Column), week), {
        width: through ? line * 0.6 : line,
        density: through ? THROUGH_DENSITY : GIVEN_DENSITY,
        bristles: through ? 8 : 18,
        dry: 0.6,
        taper: 0.12,
        lift: 0.7,
        seed: 17 + index * 31,
      });
    });
    const points: Point[] =
      player.kind === "raw"
        ? [...player.points]
        : player.kind === "path"
          ? [
              [g.x("you", start), g.y("you", 0)],
              ...player.values.map(
                (value, index): Point => [g.x("you", value), g.y("you", index + 1)],
              ),
            ]
          : [];
    if (points.length < 2) return;
    // The wash is the band: one typical move of doubt widens the brush by one move each side.
    const wash = Math.max(line * 1.5, halfWidth * 2 * g.scale);
    // The painted band has no SVG of its own, so its width is stated where it can be read.
    sumi.dataset.wash = wash.toFixed(2);
    // One diluted wash, its edge softened by a few nested fills, as the water spreads past
    // the pigment. Its width holds to the band, so it only narrows where the brush lifts.
    c.fillStyle = colours.sumi;
    c.globalAlpha = 1 - (1 - WASH_DENSITY) ** (1 / WASH_LAYERS.length);
    WASH_LAYERS.forEach((share, index) => {
      // The narrower layers start later and stop sooner, so the wash fades in and out over
      // its ends as it does across its sides, never cut square at the top or foot.
      const inset = (WASH_END * index) / (WASH_LAYERS.length - 1);
      const end = (along: number) => Math.min(1, Math.max(0, along - inset) / 2);
      const layer = ribbonPath(points, {
        width: wash * share,
        seed: 101 + index,
        profile: (at, total) =>
          Math.min(1, 0.55 + (0.45 * (total - at)) / wash) * end(at) * end(total - at),
      });
      if (layer) c.fill(layer);
    });
    c.globalAlpha = 1;
    brush(c, points, {
      width: line,
      density: CORE_DENSITY,
      bristles: 20,
      dry: 0.5,
      taper: 0.25,
      seed: 131,
    });
    core = ribbonPath(points, { width: line, seed: 131, profile: () => 1 });
  };

  const paintShu = () => {
    const c = context(shu);
    if (!geometry || !lesson || !correction) return;
    const g = geometry;
    const done = correction;
    const marked = lesson;
    const columns = ["you", "ai"] as const;
    realStrokes ??= columns.map((column) => {
      const land = column === "ai" ? 4 : 0;
      const points: Point[] = [
        [g.x(column, start), g.y(column, 0) + land],
        ...marked.actual.map((value, day): Point => [g.x(column, value), g.y(column, day + 1)]),
      ];
      return shuStroke(points, Math.max(2.5, g.rect("you").width * 0.026) * 1.5);
    });
    columns.forEach((column, index) => {
      const stroke = realStrokes?.[index]?.(done.real[index] ?? 0);
      // Without the bleed engine the canvases are the picture, so where the vermilion crosses
      // the sumi core it is parted from it by a hairline of paper; the engine does it as it
      // composes. Only your column carries sumi.
      const under = engine || column !== "you" ? null : sumi.getContext("2d");
      if (under && core && stroke) {
        const area = g.rect("you");
        const [x, y, w, h] = [area.x - 24, area.y - 24, area.width + 48, area.height + 48].map(
          (value) => Math.max(0, Math.round(value * size.ratio)),
        ) as [number, number, number, number];
        // The cut is laid on the sumi as brushed, so a repaint never cuts deeper.
        uncut ??= copyOf(sumi);
        under.save();
        under.setTransform(1, 0, 0, 1, 0, 0);
        under.clearRect(x, y, w, h);
        under.drawImage(uncut, x, y, w, h, x, y, w, h);
        under.restore();
        under.save();
        under.clip(core);
        under.globalCompositeOperation = "destination-out";
        under.lineWidth = PAPER_GAP * 2;
        under.lineJoin = "round";
        under.fill(stroke);
        under.stroke(stroke);
        under.restore();
      }
      c.fillStyle = colours.shu;
      if (stroke) {
        c.fill(stroke);
        tooth(c, stroke);
      }
    });
  };

  /**
   * Finished strokes keep their outline, so a frame of the reveal only traces the strokes still
   * being written. Anything that moves the sheet or changes the lesson clears it.
   */
  const settled = new Map<string, Path2D | null>();
  const outline = (stroke: Stroke, widen = 0) => {
    const spec = {
      width: stroke.width + widen,
      seed: stroke.seed,
      upto: stroke.upto,
      profile: (at: number, total: number) =>
        ((stroke.profile?.(at, total) ?? 1) * stroke.width + widen) / (stroke.width + widen),
    };
    if (stroke.upto < 1) return ribbonPath(stroke.points(), spec);
    const key = `${stroke.key}:${widen}`;
    if (!settled.has(key)) settled.set(key, ribbonPath(stroke.points(), spec));
    return settled.get(key) ?? null;
  };
  let boxes: ReturnType<Lesson["boxes"]> | undefined;
  let realStrokes: readonly ReturnType<typeof shuStroke>[] | undefined;
  let winnerStroke: Omit<Stroke, "upto"> | undefined;
  const scoreFigures = new Map<string, { points: Point[]; down: (at: number) => number }[]>();

  /** Each day is marked on the written point itself, as a teacher marks on the writing. */
  const paintMarks = () => {
    const c = context(marks);
    if (!geometry || !lesson || !correction) return;
    const g = geometry;
    const done = correction;
    const marked = lesson;
    const { radius, inner } = markRadii(g);
    // Day marks first, then the scores, then the hanamaru, in the order the teacher writes.
    const strokes: Stroke[] = [];
    done.marks.forEach(([you, ai], day) => {
      for (const [column, progress] of [
        ["you", you],
        ["ai", ai],
      ] as const) {
        const cell = marked.cells[column][day];
        // A day further than two typical moves gets no mark: a miss earns nothing.
        if (progress <= 0 || cell === "white" || cell === undefined) continue;
        const cx = g.x(column, marked.paths[column][day] ?? start);
        const cy = g.y(column, day + 1);
        const seed = 400 + day * 7 + (column === "you" ? 0 : 3);
        // Each ring is left open where the brush landed, so it reads as written, not stamped.
        const rings = cell === "green" ? [radius, inner] : [radius];
        rings.forEach((ringRadius, index) => {
          const upto =
            rings.length === 1 ? progress : Math.min(1, Math.max(0, progress * 2 - index));
          if (upto > 0)
            strokes.push({
              key: `${column}${day}:${index}`,
              points: () => circlePath(cx, cy, ringRadius, seed + index, index ? 0.88 : 0.9),
              width: MARK_WIDTH,
              upto,
              seed: seed + 11 + index,
              profile: even,
            });
        });
      }
    });
    // Day marks are a fine brush, too thin to break; the scores and the hanamaru are loaded.
    const dayMarks = strokes.length;
    if (done.scores > 0 && boxes === undefined) boxes = marked.boxes();
    const placed = done.scores > 0 ? boxes : null;
    if (placed) {
      // The teacher writes the AI's score, then yours.
      (["ai", "you"] as const).forEach((column, order) => {
        const text = String(marked.scores[column]);
        let figures = scoreFigures.get(column);
        if (!figures) {
          figures = numeralStrokes(text, placed[column], 700 + order).map((points) => ({
            points,
            down: downward(points),
          }));
          scoreFigures.set(column, figures);
        }
        const share = Math.min(1, Math.max(0, done.scores * 2 - order)) * figures.length;
        const height = numeralBox(text, placed[column]).height;
        figures.forEach(({ points, down }, index) => {
          const upto = Math.min(1, Math.max(0, share - index));
          if (upto <= 0) return;
          strokes.push({
            key: `${column}-score:${index}`,
            points: () => points,
            width: Math.max(2.5, height * 0.12),
            upto,
            seed: 720 + index,
            // Pressed on the down strokes, lifted to about half on the turns and up strokes.
            profile: (at, total) => hand(at, total) * (0.55 + 0.6 * down(at)),
          });
        });
      });
    }
    const winner = marked.winner && placed && done.circle > 0 ? placed[marked.winner] : null;
    if (winner && marked.winner) {
      if (!winnerStroke) {
        const box = numeralBox(String(marked.scores[marked.winner]), winner);
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        // The spiral's first turn sits just outside the figures, its petals beyond it.
        const reach = Math.max(box.width / 2, box.height / 2) + 7;
        const flower = hanamaruPath(cx, cy, reach / 0.6, 907);
        const bend = turning(flower);
        winnerStroke =
          marked.winner === "you"
            ? {
                key: "hanamaru",
                points: () => flower,
                width: 6,
                seed: 913,
                // Lands and pools, runs lighter round the ring, swells through the join into the
                // petals at about 6 px, eases through each cusp, and lifts away in the flick.
                profile: (at, total) =>
                  ((2.5 + 3.5 * smoothstep(0.12, 0.4, at / total) + 2.4 * Math.exp(-at / 5)) / 6) *
                  (1 - 0.45 * bend(at)) *
                  Math.max(0.08, Math.min(1, (total - at) / (total * 0.035))) ** 0.7,
              }
            : {
                key: "circle",
                points: () => circlePath(cx, cy, reach, 911, 0.94),
                width: 4,
                seed: 913,
              };
      }
      strokes.push({ ...winnerStroke, upto: done.circle });
    }
    if (strokes.length === 0) return;
    // Vermilion is opaque, so a mark simply lies over the sumi, as a red brush on dry ink does.
    c.fillStyle = colours.shu;
    strokes.forEach((stroke, index) => {
      const ink = outline(stroke);
      if (!ink) return;
      c.fill(ink);
      if (index >= dayMarks) tooth(c, ink);
    });
  };

  const tell = (change: InkChange) => engine?.changed(change);

  return {
    canvases: { sumi, shu },
    /** Size the canvases to the sheet; the ratio is capped by the caller. */
    resize(width: number, height: number, ratio: number, plotBottom: number) {
      // Only dry marks reach the scores; bleeding ink stops just beyond the plotted week.
      const strokeHeight = Math.min(height, Math.ceil(plotBottom + WASH_END * 2));
      // Setting a canvas size wipes it, so an unchanged size leaves the ink where it lies, and
      // a sheet that only grows or shrinks below (the result arriving) keeps its laid strokes.
      if (
        width === size.width &&
        height === size.height &&
        ratio === size.ratio &&
        strokeHeight === size.strokeHeight
      )
        return;
      const keep = laid !== "" && width === size.width && ratio === size.ratio;
      const resizeStrokes = !keep || strokeHeight !== size.strokeHeight;
      size = { width, height, ratio, strokeHeight };
      if (!keep) laid = "";
      settled.clear();
      boxes = undefined;
      realStrokes = undefined;
      winnerStroke = undefined;
      scoreFigures.clear();
      for (const canvas of [sumi, shu, marks]) {
        if (canvas !== marks && !resizeStrokes) continue;
        const canvasHeight = canvas === marks ? height : strokeHeight;
        // Only the sumi is copied across; the teacher's layers are cheaper to write again.
        const before = keep && canvas === sumi ? copyOf(canvas) : null;
        canvas.width = Math.max(1, Math.round(width * ratio));
        canvas.height = Math.max(1, Math.round(canvasHeight * ratio));
        canvas.style.width = `${width}px`;
        canvas.style.height = `${canvasHeight}px`;
        if (before) canvas.getContext("2d")?.drawImage(before, 0, 0);
      }
      if (keep) {
        if (resizeStrokes) paintShu();
        paintMarks();
      }
      if (resizeStrokes) engine?.resize(keep);
    },
    sheet(next: SheetGeometry, weeks: readonly Week[], today: number) {
      // A repaint that would lay the same strokes in the same places is skipped: it is the
      // costliest thing the page draws, and locking or revealing often changes nothing here.
      const key = JSON.stringify([COLUMNS.map((column) => next.rect(column)), next.domain, today]);
      if (key === laid && weeks === given) return;
      laid = key;
      settled.clear();
      boxes = undefined;
      realStrokes = undefined;
      winnerStroke = undefined;
      scoreFigures.clear();
      geometry = next;
      given = weeks;
      start = today;
      paintSumi();
      paintShu();
      paintMarks();
      tell({ sumi: "reset", shu: "reset" });
    },
    band(next: number) {
      if (next === halfWidth) return;
      halfWidth = next;
      if (player.kind === "none") return;
      paintSumi();
      tell({ sumi: "reset" });
    },
    raw(points: readonly Point[]) {
      player = { kind: "raw", points };
      paintSumi();
      tell({ sumi: "add" });
    },
    path(values: readonly number[], nextHalfWidth: number) {
      const same =
        player.kind === "path" &&
        nextHalfWidth === halfWidth &&
        values.every(
          (value, index) => value === (player.kind === "path" ? player.values[index] : NaN),
        );
      if (same) return;
      player = { kind: "path", values: [...values] };
      halfWidth = nextHalfWidth;
      paintSumi();
      tell({ sumi: "reset" });
    },
    /**
     * The key's mark, drawn by the same brush at the same size as the marks on the sheet, so
     * the key shows exactly what the sheet does. Null before the sheet is laid out.
     */
    markGlyph(cell: Exclude<Cell, "white">): string | null {
      if (!geometry) return null;
      const { radius, inner } = markRadii(geometry);
      const size = Math.ceil(radius * 2.3 + MARK_WIDTH * 2);
      const centre = size / 2;
      const rings =
        ringData(centre, centre, radius, 3, 0.9) +
        (cell === "green" ? ringData(centre, centre, inner, 4, 0.88) : "");
      return `<svg class="mark-glyph" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><path d="${rings}"/></svg>`;
    },
    lesson(next: Lesson) {
      lesson = next;
      settled.clear();
      boxes = undefined;
      realStrokes = undefined;
      winnerStroke = undefined;
      scoreFigures.clear();
    },
    correct(next: Correction) {
      const strokes = JSON.stringify(next.real) !== JSON.stringify(correction?.real);
      const marks =
        JSON.stringify([next.marks, next.scores, next.circle]) !==
        JSON.stringify([correction?.marks, correction?.scores, correction?.circle]);
      correction = next;
      // The marks are a separate dry layer, so a new mark leaves the bleeding strokes alone.
      if (strokes) {
        paintShu();
        tell({ shu: "add" });
      }
      if (marks) paintMarks();
    },
    attach(next: InkEngine) {
      engine = next;
      engine.changed({ sumi: "reset", shu: "reset" });
    },
    destroy() {
      engine?.destroy();
      sumi.remove();
      shu.remove();
      marks.remove();
    },
  };
}

export type Ink = ReturnType<typeof createInk>;

/** Three strokes of the player's brush, sure to unsure, as the band will widen it. */
const SWATCH = { width: 116, height: 56, washes: [0, 16, 32], core: 6 } as const;

export function paintSwatch(canvas: HTMLCanvasElement, sumi: string, ratio: number) {
  canvas.width = SWATCH.width * ratio;
  canvas.height = SWATCH.height * ratio;
  canvas.style.width = `${SWATCH.width}px`;
  canvas.style.height = `${SWATCH.height}px`;
  const c = canvas.getContext("2d");
  if (!c) return;
  c.setTransform(ratio, 0, 0, ratio, 0, 0);
  c.strokeStyle = c.fillStyle = sumi;
  const centres = [SWATCH.core / 2 + 2, 46, SWATCH.width - SWATCH.washes[2] / 2 - 1];
  SWATCH.washes.forEach((wash, index) => {
    const x = centres[index] ?? 0;
    const points: Point[] = [
      [x, 3],
      [x + 1.5, SWATCH.height / 2],
      [x - 0.5, SWATCH.height - 3],
    ];
    if (wash > 0) {
      c.globalAlpha = 1 - (1 - WASH_DENSITY) ** (1 / WASH_LAYERS.length);
      for (const share of WASH_LAYERS)
        ribbon(c, points, {
          width: wash * share,
          seed: 61 + index,
          // Feathered at both ends as well as the sides, so no swatch reads as a box.
          profile: (at, total) => Math.min(1, 0.45 + at / 12, 0.45 + (total - at) / 12),
        });
      c.globalAlpha = 1;
    }
    brush(c, points, {
      width: SWATCH.core,
      density: CORE_DENSITY,
      bristles: 8,
      dry: 0.4,
      taper: 0.3,
      seed: 71 + index,
    });
  });
}
