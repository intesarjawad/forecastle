import { expect, test } from "vitest";
import { shareText } from "../../src/core/share";
import type { Cell } from "../../src/core/types";
import { parseAnswer } from "../../src/io/answers";
import { parsePuzzle } from "../../src/io/puzzle-validation";
import { type ChartState, renderChart } from "../../src/ui/chart";
import { scoreMatch } from "../../src/ui/reveal";
import { worstCases } from "../fixtures/worst-case";

const GREEN = "\u25CE";
const YELLOW = "\u25CB";
const LINK = "https://example.org/";
// The phone chart and the widest card the site ever draws.
const SIZES = [
  { width: 332, height: 332 },
  { width: 1024, height: 576 },
] as const;
const EXPECTED_TICKS: Record<string, readonly string[]> = {
  "long-label": ["8", "10", "12", "14"],
  millions: ["2M", "2.2M", "2.4M"],
  "negative-temperatures": ["-30", "-20", "-10", "0"],
  "flat-window": ["0", "5", "10"],
  spike: ["48", "50", "52"],
  "missing-answer": ["-5", "0", "5"],
};
// Only the spike leaves the puzzle domain once the answer arrives.
const EXPECTED_REVEALED_TICKS: Record<string, readonly string[]> = {
  ...EXPECTED_TICKS,
  spike: ["500", "1,000"],
};

function render(state: ChartState): string {
  const slot = { innerHTML: "" };
  renderChart(state, slot);
  return slot.innerHTML;
}

function revealedState(
  puzzle: ReturnType<typeof parsePuzzle>,
  answer: ReturnType<typeof parseAnswer>,
  { width, height }: (typeof SIZES)[number],
): ChartState {
  const halfWidth = puzzle.typicalMove;
  return {
    id: puzzle.id,
    label: puzzle.label,
    unit: puzzle.unit,
    width,
    height,
    visible: puzzle.visible,
    yDomain: puzzle.yDomain,
    player: {
      path: answer.actual,
      band: {
        lower: answer.actual.map((value) => value - halfWidth),
        upper: answer.actual.map((value) => value + halfWidth),
      },
    },
    model: { median: puzzle.ai.median, interval: { lower: puzzle.ai.q10, upper: puzzle.ai.q90 } },
    real: answer.actual,
    dates: answer.dates,
  };
}

function lockedState(
  puzzle: ReturnType<typeof parsePuzzle>,
  { width, height }: (typeof SIZES)[number],
): ChartState {
  const path = Array.from({ length: 7 }, () => puzzle.visible.at(-1) ?? 0);
  return {
    id: puzzle.id,
    label: puzzle.label,
    unit: puzzle.unit,
    width,
    height,
    visible: puzzle.visible,
    yDomain: puzzle.yDomain,
    player: {
      path,
      band: {
        lower: path.map((value) => value - puzzle.typicalMove),
        upper: path.map((value) => value + puzzle.typicalMove),
      },
    },
  };
}

function endLabels(markup: string) {
  return [
    ...markup.matchAll(
      /<text x="([\d.]+)" y="([\d.]+)" class="chart-end-label [^"]+" text-anchor="start">(\w+)<\/text>/gu,
    ),
  ].map((match) => ({ x: Number(match[1]), y: Number(match[2]), name: match[3] }));
}

function axisTicks(markup: string) {
  return [
    ...markup.matchAll(/<text x="32" y="([\d.]+)" class="" text-anchor="end">([^<]+)<\/text>/gu),
  ].map((match) => ({ y: Number(match[1]), label: match[2] ?? "" }));
}

test.each(worstCases)(
  "$name renders finite geometry, ticks and labels",
  ({ name, puzzle, answer }) => {
    const parsed = parsePuzzle(puzzle);
    const locked = render(lockedState(parsed, SIZES[0]));
    expect(locked).not.toMatch(/NaN|Infinity|undefined/u);
    expect(axisTicks(locked).map(({ label }) => label)).toEqual(EXPECTED_TICKS[name]);
    // Until an answer arrives there is only the player's endpoint label.
    const lockedLabels = endLabels(locked);
    expect(lockedLabels.map(({ name: label }) => label)).toEqual(["You"]);
    expect(lockedLabels.every(({ y }) => y >= 28 && y <= SIZES[0].height - 48 + 0.01)).toBe(true);
    if (answer === null) return;
    const recorded = parseAnswer(answer, parsed.id);
    for (const size of SIZES) {
      const markup = render(revealedState(parsed, recorded, size));
      expect(markup).not.toMatch(/NaN|Infinity|undefined/u);
      const ticks = axisTicks(markup);
      expect(ticks.map(({ label }) => label)).toEqual(EXPECTED_REVEALED_TICKS[name]);
      expect(ticks.every(({ y }) => y >= 12 && y <= size.height - 12)).toBe(true);
      const labels = endLabels(markup);
      expect(labels.map(({ name: label }) => label).sort()).toEqual(["AI", "Real", "You"]);
      // Endpoint labels never overlap, even when all three forecast ends coincide.
      for (let index = 1; index < labels.length; index += 1) {
        const previous = labels[index - 1];
        const current = labels[index];
        if (!previous || !current) throw new Error("Missing endpoint label.");
        expect(current.y - previous.y).toBeGreaterThanOrEqual(23.99);
      }
      // Text baselines sit four pixels below the placed centre; the plot inset is 12.
      expect(labels.every(({ y }) => y >= 28 && y <= size.height - 36 + 0.01)).toBe(true);
      expect([...markup.matchAll(/class="chart-day-ring"/gu)]).toHaveLength(7);
      const rings = [
        ...markup.matchAll(/class="chart-day-ring" cx="([\d.]+)" cy="([\d.]+)"/gu),
      ].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));
      expect(rings.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
      expect(rings.every(({ x, y }) => x >= 0 && x <= size.width && y >= 12)).toBe(true);
      expect(rings.every(({ y }) => y <= size.height - 28)).toBe(true);
    }
  },
);

test("the long label fills its documented limit without shortening the chart title", () => {
  const item = worstCases.find(({ name }) => name === "long-label");
  if (!item) throw new Error("Missing long-label fixture.");
  const puzzle = parsePuzzle(item.puzzle);
  expect(puzzle.label).toHaveLength(60);
  const markup = render(lockedState(puzzle, SIZES[0]));
  expect(markup).toContain(`aria-label="${puzzle.label}"`);
  expect(markup).toContain(`<title>${puzzle.label}</title>`);
});

test("millions stay compact on the axis and readable in the accessible table", () => {
  const item = worstCases.find(({ name }) => name === "millions");
  const answer = item?.answer;
  if (!item || answer === null || answer === undefined)
    throw new Error("Missing millions fixture.");
  const puzzle = parsePuzzle(item.puzzle);
  const markup = render(revealedState(puzzle, parseAnswer(answer, puzzle.id), SIZES[0]));
  expect(markup).not.toContain(">1804000<");
  expect(markup).toContain('<th scope="row">today</th><td>2420000</td>');
  expect(markup).toContain(
    "<desc>Visible 28 days: start 2000000 USD, end 2420000 USD, minimum 1980000 USD, maximum 2420000 USD.</desc>",
  );
});

test("a twentyfold answer spike is redrawn below the plot ceiling", () => {
  const item = worstCases.find(({ name }) => name === "spike");
  const answer = item?.answer;
  if (!item || answer === null || answer === undefined) throw new Error("Missing spike fixture.");
  const puzzle = parsePuzzle(item.puzzle);
  const markup = render(revealedState(puzzle, parseAnswer(answer, puzzle.id), SIZES[0]));
  const rings = [...markup.matchAll(/class="chart-day-ring" cx="([\d.]+)" cy="([\d.]+)"/gu)].map(
    (match) => ({ y: Number(match[2]) }),
  );
  // Day four reaches 1000 against a visible range near 50, so the domain grows to about 1052.
  expect(rings[3]?.y).toBeGreaterThan(12);
  expect(rings[3]?.y).toBeLessThan(40);
});

test.each(worstCases.filter(({ answer }) => answer !== null))(
  "$name formats the same hand-computed result for sharing",
  ({ puzzle, answer }) => {
    const parsed = parsePuzzle(puzzle);
    if (answer === null) throw new Error("Missing answer fixture.");
    const recorded = parseAnswer(answer, parsed.id);
    const forecast = { path: recorded.actual, multiplier: 1 };
    const { you, ai } = scoreMatch(parsed, forecast, recorded);
    expect(you).toEqual({
      closeness: 100,
      coverage: 7,
      cells: Array<Cell>(7).fill("green"),
    });
    expect(ai).toEqual({
      closeness: 45,
      coverage: 0,
      cells: Array<Cell>(7).fill("yellow"),
    });
    expect(
      shareText({
        kind: "daily",
        number: parsed.number,
        you: you.closeness,
        ai: ai.closeness,
        youCells: you.cells,
        aiCells: ai.cells,
        bandCaught: you.coverage,
        link: LINK,
      }),
    ).toBe(
      [
        `Forecastle #${parsed.number}: You 100, AI 45`,
        `You ${GREEN.repeat(7)}`,
        `AI  ${YELLOW.repeat(7)}`,
        "Band caught 7/7",
        LINK,
      ].join("\n"),
    );
  },
);
