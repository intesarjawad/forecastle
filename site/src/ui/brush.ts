/**
 * A loaded brush lays a solid body with a pressed head. On a dry brush the body narrows in
 * the last third and the outer bristles carry on alone, inking unevenly and running out,
 * which leaves the white streaks of kasure at the edge.
 * Every random choice is seeded, so a repaint lays each bristle where it lay before.
 */
export type Point = readonly [number, number];

export type Brush = {
  /** Full width across the stroke, in CSS pixels. */
  readonly width: number;
  /** Ink carried by the whole stack of bristles, from 0 to 1. */
  readonly density: number;
  readonly bristles: number;
  readonly seed: number;
  /** How far the outer bristles run dry toward the end, from 0 (wet) to 1. */
  readonly dry?: number;
  /** Fraction of the stroke laid so far. */
  readonly upto?: number;
  /** Narrowest share of the width, at the press and the lift. */
  readonly taper?: number;
  /** Share of the stroke over which the brush lifts to its narrowest, for a long fade. */
  readonly lift?: number;
};

const SAMPLE_SPACING = 2.5;
const PRESS_LENGTH = 10;
const LIFT_LENGTH = 18;

const smooth = (t: number) => t * t * (3 - 2 * t);
/** Share of the width the body keeps once the brush has run dry. */
const DRY_BODY = 0.8;
/** How far, in pixels, the body takes to give way once the brush runs dry. */
const DRY_TAPER_FROM = 8;
const DRY_TAPER_TO = 12;
/** How far, in pixels, a parted hair takes to swing out from the body's edge to its own line. */
const HAIR_PARTS = 10;

/**
 * Where a brush runs dry, from how it was moved. The knots are even ticks of the hand (a day of
 * a given week, a pointer sample of yours), so a long span between two is a fast one and lays
 * less ink on each pixel; a turn slows the hand and spends more. The brush holds between a
 * half and four fifths of what the whole stroke would spend.
 */
function runsDry(
  points: readonly Point[],
  length: readonly number[],
  turn: (at: number) => number,
  random: () => number,
): number {
  const spans = points.slice(1).map((point, index) => {
    const from = points[index] ?? point;
    return Math.hypot(point[0] - from[0], point[1] - from[1]);
  });
  const chord = spans.reduce((sum, span) => sum + span, 0) || 1;
  const mean = chord / Math.max(1, spans.length);
  const total = length.at(-1) || 1;
  const spent: number[] = [0];
  // The samples run in order, so the span each falls in only ever moves on.
  let span = 0;
  let spanEnd = (spans[0] ?? chord) / chord;
  for (let index = 1; index < length.length; index += 1) {
    const at = length[index] ?? 0;
    while (at / total > spanEnd + 1e-9 && span < spans.length - 1) {
      span += 1;
      spanEnd += (spans[span] ?? 0) / chord;
    }
    const ink = (0.6 + 0.8 * turn(at)) / Math.sqrt((spans[span] ?? mean) / mean || 1);
    spent.push((spent[index - 1] ?? 0) + (at - (length[index - 1] ?? 0)) * ink);
  }
  const load = (spent.at(-1) ?? 0) * (0.55 + random() * 0.25);
  const dryIndex = spent.findIndex((amount) => amount >= load);
  return length[dryIndex] ?? total;
}

export function seeded(seed: number): () => number {
  // The seed is scattered first: on its own the generator starts a small seed near zero and
  // keeps evenly spaced seeds in step, so neighbouring strokes would share their quirks.
  let mixed = Math.floor(Math.abs(seed)) >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85ebca6b);
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35);
  let state = ((mixed ^ (mixed >>> 16)) >>> 0) % 2147483646 || 1;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

/** Catmull-Rom through the knots, resampled about every 2.5 px with normals and arc length. */
export function sampleStroke(points: readonly Point[]) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] ?? p2;
    if (!p0 || !p1 || !p2 || !p3) continue;
    const steps = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / SAMPLE_SPACING));
    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      const spline = (a: number, b: number, c: number, d: number) =>
        0.5 *
        (2 * b +
          (-a + c) * t +
          (2 * a - 5 * b + 4 * c - d) * t * t +
          (-a + 3 * b - 3 * c + d) * t * t * t);
      xs.push(spline(p0[0], p1[0], p2[0], p3[0]));
      ys.push(spline(p0[1], p1[1], p2[1], p3[1]));
    }
  }
  const end = points.at(-1);
  if (end) {
    xs.push(end[0]);
    ys.push(end[1]);
  }
  const length: number[] = [0];
  for (let index = 1; index < xs.length; index += 1)
    length.push(
      (length[index - 1] ?? 0) +
        Math.hypot(
          (xs[index] ?? 0) - (xs[index - 1] ?? 0),
          (ys[index] ?? 0) - (ys[index - 1] ?? 0),
        ),
    );
  const normals = xs.map((_, index) => {
    const a = Math.max(0, index - 2);
    const b = Math.min(xs.length - 1, index + 2);
    const dx = (xs[b] ?? 0) - (xs[a] ?? 0);
    const dy = (ys[b] ?? 0) - (ys[a] ?? 0);
    const size = Math.hypot(dx, dy) || 1;
    return [-dy / size, dx / size] as const;
  });
  return { xs, ys, length, normals, total: length.at(-1) ?? 0 };
}

/**
 * How sharply the stroke turns at each arc length, from 0 on a straight run to 1 on the
 * tightest turn, smoothed over a few samples as a hand slows into a bend and out of it.
 */
export function turning(points: readonly Point[]): (at: number) => number {
  const { normals, length } = sampleStroke(points);
  const bend = normals.map((normal, index) => {
    const before = normals[Math.max(0, index - 4)] ?? normal;
    const after = normals[Math.min(normals.length - 1, index + 4)] ?? normal;
    return 1 - (before[0] * after[0] + before[1] * after[1]);
  });
  const most = Math.max(1e-6, ...bend);
  // A ribbon asks in order along the stroke, so the search walks on from where it stopped.
  let cursor = 0;
  return (at) => {
    if ((length[cursor] ?? 0) > at) cursor = 0;
    while (cursor < length.length - 1 && (length[cursor] ?? 0) < at) cursor += 1;
    return (bend[cursor] ?? 0) / most;
  };
}

/**
 * How steeply the stroke runs down the page at each arc length, from 0 going up or across to 1
 * straight down. A brush is pressed on the down strokes and lifted on the rest, which is what
 * gives brushed figures their thick and thin.
 */
export function downward(points: readonly Point[]): (at: number) => number {
  const { normals, length } = sampleStroke(points);
  // The normal is the tangent turned a quarter, so its negated x is the tangent's y.
  const down = normals.map(([nx]) => Math.max(0, -nx));
  let cursor = 0;
  return (at) => {
    if ((length[cursor] ?? 0) > at) cursor = 0;
    while (cursor < length.length - 1 && (length[cursor] ?? 0) < at) cursor += 1;
    return down[cursor] ?? 0;
  };
}

/** Lay one stroke of a bristle brush onto a 2D context. */
export function brush(context: CanvasRenderingContext2D, points: readonly Point[], spec: Brush) {
  if (points.length < 2) return;
  const { xs, ys, length, normals, total } = sampleStroke(points);
  if (total === 0) return;
  const random = seeded(spec.seed);
  const upto = Math.max(0, Math.min(1, spec.upto ?? 1)) * total;
  const taper = spec.taper ?? 0.35;
  const liftLength = Math.max(LIFT_LENGTH, total * (spec.lift ?? 0));
  const dry = spec.dry ?? 0;
  const count = Math.max(2, Math.round(spec.bristles));
  // The brush lands pressed (kihitsu): a rounded head a touch wider than the body, never a point.
  const head = Math.max(1, spec.width * 0.45);
  const press = (at: number) => {
    const landing = Math.min(1, at / head);
    return Math.sqrt(1 - (1 - landing) ** 2) * (1 + 0.15 * Math.max(0, 1 - at / PRESS_LENGTH));
  };
  const lift = (at: number) => Math.min(1, taper + ((1 - taper) * (total - at)) / liftLength);
  // Only a dry brush breaks, and only at its edge (kasure): there the solid body narrows and
  // the outer hairs carry on alone, skipping over the paper's tooth.
  const turn = turning(points);
  const dryFrom = dry > 0 ? runsDry(points, length, turn, random) : Number.POSITIVE_INFINITY;
  // The body gives up only its edge, so the stroke keeps its line and narrows by a fifth.
  const thinnest = DRY_BODY + (random() - 0.5) * 0.08;
  // The body gives way over about a brush's width, never in one step.
  const dryLength = DRY_TAPER_FROM + random() * (DRY_TAPER_TO - DRY_TAPER_FROM);
  const body = (at: number) =>
    1 -
    (1 - thinnest) *
      smooth(Math.min(1, Math.max(0, (at - dryFrom) / dryLength))) *
      (1 - 0.6 * turn(at));
  context.fillStyle = context.strokeStyle;
  context.globalAlpha = spec.density;
  const outline = ribbonPath(points, {
    width: spec.width,
    seed: spec.seed,
    upto: upto / total,
    profile: (at) => press(at) * lift(at) * body(at),
  });
  if (outline) context.fill(outline);
  if (!outline || dry === 0 || upto <= dryFrom) {
    context.globalAlpha = 1;
    return;
  }
  // Hairs show only off the body: laid over it they would ink it twice and darken it.
  context.save();
  const offBody = new Path2D();
  offBody.rect(-1e5, -1e5, 2e5, 2e5);
  offBody.addPath(outline);
  context.clip(offBody, "evenodd");
  context.lineCap = "round";
  context.lineJoin = "round";
  // Hairs either side of the middle run out in pairs, so the stroke never leans to one side.
  const loads = Array.from({ length: Math.ceil(count / 2) }, () => random());
  for (let bristle = 0; bristle < count; bristle += 1) {
    const across = bristle / (count - 1) - 0.5;
    const offset = across * spec.width + (random() - 0.5) * Math.min(1.6, spec.width / count);
    const outer = Math.abs(across) * 2;
    const ink = random();
    const width = random();
    const loaded = loads[Math.min(bristle, count - 1 - bristle)] ?? 0.5;
    // Only the hairs the dry body leaves behind show, so they never ink over the body itself.
    if (outer < thinnest) continue;
    const runsOut = total * (1 - dry * 0.3 * outer * (0.3 + loaded * 0.7));
    const skipEvery = 20 + random() * 50;
    // A hair carries less ink than the body, never more, so the break lightens the stroke.
    context.globalAlpha = spec.density * (0.55 + ink * 0.45);
    context.lineWidth = Math.max(0.6, (spec.width / (count - 1)) * (1.2 + width * 0.6));
    const inside = Math.max(0, Math.abs(offset) - (thinnest * spec.width) / 2);
    context.beginPath();
    let pen = false;
    // Each hair parts from the body at its own point once the body has narrowed, so the
    // break opens raggedly out of solid ink rather than along one line.
    const parts = dryFrom + dryLength * (1 + random() * 2);
    let nextGap = parts + total * 0.05 + skipEvery * random();
    let gapUntil = -1;
    for (let index = 0; index < xs.length; index += 1) {
      const at = length[index] ?? 0;
      if (at > upto || at > runsOut) break;
      if (at < parts) continue;
      // A hair leaves from just inside the narrowed body's edge, so the outline never steps
      // where it parts.
      const out = smooth(Math.min(1, (at - parts) / HAIR_PARTS));
      const reach =
        (offset - Math.sign(offset) * (inside + context.lineWidth / 2) * (1 - out)) * lift(at);
      const [nx, ny] = normals[index] ?? [0, 0];
      const x = (xs[index] ?? 0) + nx * reach;
      const y = (ys[index] ?? 0) + ny * reach;
      if (at > nextGap) {
        gapUntil = at + 4 + random() * 10;
        nextGap = gapUntil + skipEvery * (0.5 + random());
      }
      if (at < gapUntil) {
        pen = false;
        continue;
      }
      if (pen) context.lineTo(x, y);
      else context.moveTo(x, y);
      pen = true;
    }
    context.stroke();
  }
  context.restore();
  context.globalAlpha = 1;
}

const TURN = Math.PI * 2;

/**
 * One continuous circle, begun at the top and drawn anticlockwise, closing a little past
 * its start the way a quick hand overshoots. Radius wavers slightly so no two are equal.
 */
export function circlePath(cx: number, cy: number, r: number, seed: number, sweep = 1.06): Point[] {
  const random = seeded(seed);
  const wobble = 0.04 + random() * 0.04;
  const phase = random() * TURN;
  const start = -Math.PI / 2 - 0.2;
  const points: Point[] = [];
  for (let step = 0; step <= 48; step += 1) {
    const t = step / 48;
    const angle = start - t * sweep * TURN;
    const radius = r * (1 + wobble * Math.sin(angle * 2 + phase) - 0.05 * t);
    points.push([cx + Math.cos(angle) * radius * 1.04, cy + Math.sin(angle) * radius]);
  }
  return points;
}

/**
 * The hanamaru: one stroke that begins just round the work and winds almost a full ring, then
 * runs on without lifting into five petals. Each petal springs out of the ring and falls back
 * to a deep cusp beside it, and the last one leaves at its crown in a flick, the stroke's end.
 * The brush is wettest where it lands, so the first point is where the ink pools.
 */
export function hanamaruPath(cx: number, cy: number, r: number, seed: number): Point[] {
  const random = seeded(seed);
  const points: Point[] = [];
  const at = (angle: number, radius: number): Point => [
    cx + Math.cos(angle) * radius * 1.08,
    cy + Math.sin(angle) * radius,
  ];
  // Begun a little above the right, so the last petal's flick leaves low on the right, away
  // from the sheet above and towards the open paper beside it.
  const start = -0.35;
  // The ring holds its radius round the figures, and only in its last stretch swings out to
  // the cusps, so it runs into the first petal without lifting. The cusps stand a clear 3 to
  // 4 px of paper off the ring, edge to edge, once both strokes' widths are allowed for.
  const ring = 0.56;
  const cusp = ring + Math.max(0.1, 7 / r);
  const wind = 0.95;
  for (let step = 0; step <= 48; step += 1) {
    const t = step / 48;
    const swing = smooth(Math.min(1, Math.max(0, (t - 0.82) / 0.18)));
    points.push(at(start - t * wind * TURN, r * (ring + (cusp - ring) * swing)));
  }
  // Petals near enough even, as a practised hand makes them, each leaning the way the brush
  // travels and opening to its own depth.
  const shares = Array.from({ length: PETALS }, () => 0.85 + random() * 0.3);
  const depths = Array.from({ length: PETALS }, () => 0.38 + random() * 0.1);
  const leans = Array.from({ length: PETALS }, () => 0.15 + random() * 0.2);
  const sum = shares.reduce((a, b) => a + b, 0);
  let angle = start - wind * TURN;
  let crown = r;
  shares.forEach((petal, index) => {
    const sweep = (petal / sum) * TURN;
    const lean = leans[index] ?? 0.25;
    const depth = depths[index] ?? 0.5;
    // The last petal is written only to its crown; the flick carries it away from there.
    const last = index === PETALS - 1;
    const steps = last ? 20 : 36;
    for (let step = 1; step <= steps; step += 1) {
      const u = step / 36;
      const travel = u - (lean * Math.sin(2 * Math.PI * u)) / (2 * Math.PI);
      // The first petal leaves the ring along it, so the join reads as one stroke turning.
      const rise = index === 0 && u < 0.5 ? 1.6 : 0.6;
      crown = r * (cusp + depth * Math.sin(Math.PI * u) ** rise);
      points.push(at(angle - travel * sweep, crown));
    }
    if (last)
      angle -= sweep * (20 / 36 - (lean * Math.sin((2 * Math.PI * 20) / 36)) / (2 * Math.PI));
    else angle -= sweep;
  });
  // The flick runs on from the crown, fast and outward, and lifts.
  for (let step = 1; step <= 10; step += 1) {
    const u = step / 10;
    points.push(at(angle - u * 0.45, crown + r * 0.16 * u));
  }
  return points;
}

/** Where a written number sits inside its box, so marks can be laid round the figures. */
export function numeralBox(
  text: string,
  box: { x: number; y: number; width: number; height: number },
) {
  const height = Math.min(box.height * 0.64, box.width / (text.length * 0.75));
  const width = height * NUMERAL_WIDTH * text.length + height * NUMERAL_GAP * (text.length - 1);
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

/**
 * A number written by hand: each figure as the strokes a hand makes, in a unit box, slanted
 * forward a little and set unevenly on its line.
 */
export function numeralStrokes(
  text: string,
  box: { x: number; y: number; width: number; height: number },
  seed: number,
): Point[][] {
  const random = seeded(seed);
  const set = numeralBox(text, box);
  const strokes: Point[][] = [];
  [...text].forEach((figure, index) => {
    const left = set.x + index * set.height * (NUMERAL_WIDTH + NUMERAL_GAP);
    const rise = (random() - 0.5) * set.height * 0.06;
    for (const stroke of NUMERALS[figure] ?? []) {
      strokes.push(
        stroke.map(
          ([u, v]): Point => [
            left + u * set.height * NUMERAL_WIDTH + (0.5 - v) * set.height * 0.12,
            set.y + v * set.height + rise,
          ],
        ),
      );
    }
  });
  return strokes;
}

const PETALS = 5;
const NUMERAL_WIDTH = 0.58;
const NUMERAL_GAP = 0.16;
const oval: Point[] = Array.from({ length: 25 }, (_, step): Point => {
  const angle = -Math.PI / 2 - (step / 24) * TURN * 1.04;
  return [0.5 + Math.cos(angle) * 0.46, 0.5 + Math.sin(angle) * 0.5];
});
/** Each figure's strokes in the order a hand writes them, in a box one unit high. */
const NUMERALS: Record<string, readonly (readonly Point[])[]> = {
  "0": [oval],
  "1": [
    [
      [0.3, 0.18],
      [0.58, 0],
      [0.55, 1],
    ],
  ],
  "2": [
    [
      [0.1, 0.24],
      [0.32, 0.02],
      [0.7, 0.03],
      [0.86, 0.26],
      [0.68, 0.55],
      [0.08, 1],
      [0.96, 0.97],
    ],
  ],
  "3": [
    [
      [0.12, 0.1],
      [0.5, 0],
      [0.84, 0.18],
      [0.68, 0.42],
      [0.38, 0.48],
      [0.76, 0.56],
      [0.9, 0.8],
      [0.58, 1],
      [0.1, 0.9],
    ],
  ],
  "4": [
    [
      [0.66, 0],
      [0.06, 0.7],
      [0.96, 0.7],
    ],
    [
      [0.7, 0.32],
      [0.68, 1],
    ],
  ],
  "5": [
    [
      [0.22, 0.02],
      [0.16, 0.46],
      [0.56, 0.38],
      [0.88, 0.6],
      [0.8, 0.9],
      [0.44, 1],
      [0.1, 0.9],
    ],
    [
      [0.22, 0.03],
      [0.88, 0],
    ],
  ],
  "6": [
    [
      [0.8, 0.04],
      [0.38, 0.16],
      [0.12, 0.56],
      [0.22, 0.9],
      [0.52, 1],
      [0.84, 0.84],
      [0.8, 0.6],
      [0.5, 0.48],
      [0.14, 0.64],
    ],
  ],
  "7": [
    [
      [0.06, 0.03],
      [0.94, 0.02],
      [0.4, 1],
    ],
  ],
  "8": [
    [
      [0.82, 0.14],
      [0.5, 0],
      [0.18, 0.18],
      [0.3, 0.4],
      [0.74, 0.6],
      [0.86, 0.84],
      [0.5, 1],
      [0.14, 0.84],
      [0.26, 0.6],
      [0.7, 0.4],
      [0.84, 0.14],
    ],
  ],
  "9": [
    [
      [0.86, 0.34],
      [0.5, 0.5],
      [0.14, 0.32],
      [0.3, 0.04],
      [0.66, 0],
      [0.86, 0.24],
      [0.8, 0.64],
      [0.44, 1],
    ],
  ],
};

/**
 * One loaded stroke laid as a single filled shape, for the teacher's large gestures: the
 * width swells and eases with the hand's pressure, lands heavy and lifts to a point.
 */
export function ribbon(
  context: CanvasRenderingContext2D,
  points: readonly Point[],
  spec: RibbonSpec,
) {
  const outline = ribbonPath(points, spec);
  if (outline) context.fill(outline);
}

type RibbonSpec = {
  readonly width: number;
  readonly seed: number;
  readonly upto?: number;
  /** Share of the width at each arc length, in place of the hand's own press and lift. */
  readonly profile?: (at: number, total: number) => number;
};

/** The outline of a ribbon stroke, to fill or to clip other ink to. */
export function ribbonPath(points: readonly Point[], spec: RibbonSpec): Path2D | null {
  const outline = ribbonOutline(points, spec);
  if (!outline) return null;
  const path = new Path2D();
  for (const [index, [x, y]] of outline.entries()) {
    if (index === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.closePath();
  return path;
}

/** The ribbon's outline as points, down one side and back up the other. */
export function ribbonOutline(points: readonly Point[], spec: RibbonSpec): Point[] | null {
  if (points.length < 2) return null;
  const { xs, ys, length, normals, total } = sampleStroke(points);
  if (total === 0) return null;
  const random = seeded(spec.seed);
  const phase = random() * TURN;
  const upto = Math.max(0, Math.min(1, spec.upto ?? 1)) * total;
  const left: Point[] = [];
  const right: Point[] = [];
  for (let index = 0; index < xs.length; index += 1) {
    const at = length[index] ?? 0;
    if (at > upto) break;
    // The loaded brush rests a moment where it lands, and the ink pools there.
    const land = 1 + 0.7 * Math.max(0, 1 - at / (PRESS_LENGTH * 1.5)) ** 2;
    const lift = Math.min(1, 0.15 + (0.85 * (total - at)) / (LIFT_LENGTH * 2));
    const pressure = 0.85 + 0.15 * Math.sin((at / total) * 11 + phase);
    const half = (spec.width / 2) * (spec.profile?.(at, total) ?? land * lift * pressure);
    const [nx, ny] = normals[index] ?? [0, 0];
    const x = xs[index] ?? 0;
    const y = ys[index] ?? 0;
    left.push([x + nx * half, y + ny * half]);
    right.push([x - nx * half, y - ny * half]);
  }
  if (left.length < 2) return null;
  return [...left, ...right.reverse()];
}
