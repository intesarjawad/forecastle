import { expect, test } from "vitest";
import { type ChartState, renderChart } from "../../src/ui/chart";
import { type ChartPhase, chartFixture } from "../fixtures/chart-state";

function render(state: ChartState): string {
  const slot = { innerHTML: "" };
  renderChart(state, slot);
  return slot.innerHTML;
}

function newYork(phase: ChartPhase): ChartState {
  return { ...chartFixture("2026-10-21", phase), width: 332, height: 332 };
}

function endLabels(markup: string) {
  return [
    ...markup.matchAll(
      /<text x="([\d.]+)" y="([\d.]+)" class="chart-end-label [^"]+" text-anchor="start">(\w+)<\/text>/gu,
    ),
  ].map((match) => ({ x: Number(match[1]), y: Number(match[2]), name: match[3] }));
}

test("New York has an exact summary and all 28 history values outside the image", () => {
  const markup = render(newYork("idle"));
  expect(markup).toContain('role="img" aria-label="Daily mean temperature, New York"');
  expect(markup).toContain("<title>Daily mean temperature, New York</title>");
  expect(markup).toContain(
    "<desc>Visible 28 days: start 12 °C, end 22.6 °C, minimum 11.4 °C, maximum 26.6 °C.</desc>",
  );
  expect(markup).toContain('</svg><div class="visually-hidden"><table>');
  expect(markup).toContain('<th scope="col">Value (°C)</th>');
  expect(markup).toContain('<th scope="row">−27 d</th><td>12</td>');
  expect(markup).toContain('<th scope="row">today</th><td>22.6</td>');
  expect([...markup.matchAll(/<td>/gu)]).toHaveLength(28);
});

test("idle has 28 history points, a 63 percent split, and only relative ticks", () => {
  const markup = render(newYork("idle"));
  // 244 px plot: 153.72 px of history and 90.28 px of future, followed by a 48 px gutter.
  expect(markup).toContain('class="chart-today" d="M193.72,12L193.72,292"');
  const history = markup.match(/class="chart-history" d="([^"]+)"/u)?.[1] ?? "";
  expect(history.split("L")).toHaveLength(28);
  expect(history.startsWith("M40,")).toBe(true);
  expect(history).toContain("L193.72,");
  expect(markup).not.toContain("28 May to 3 Jun 2026");
  for (const label of ["−21 d", "−14 d", "−7 d", "today", "+7", "Start here", "next 7 days"]) {
    expect(markup).toContain(`>${label}</text>`);
  }
  for (const absent of [
    "chart-gesture",
    "chart-you-band",
    "chart-machine",
    "chart-ai-band",
    "chart-reality",
    "chart-day-ring",
  ]) {
    expect(markup).not.toContain(absent);
  }
});

test("drawn has a deterministic filled hand mark, band, and only the player's end label", () => {
  const state = newYork("drawn");
  const before = JSON.stringify(state);
  const markup = render(state);
  expect(render(state)).toBe(markup);
  expect(JSON.stringify(state)).toBe(before);
  expect(markup).toMatch(/class="chart-gesture" d="M[^"]+Z"/u);
  expect(markup).toContain('class="chart-you-band"');
  expect(endLabels(markup).map(({ name }) => name)).toEqual(["You"]);
  for (const absent of [
    "Start here",
    "chart-empty",
    "chart-machine",
    "chart-ai-band",
    "chart-reality",
  ]) {
    expect(markup).not.toContain(absent);
  }
});

test("revealed draws seven hollow day rings and uses supplied dates across the split axis", () => {
  const markup = render(newYork("revealed"));
  expect([...markup.matchAll(/class="chart-day-ring"/gu)]).toHaveLength(7);
  expect(markup).toContain('class="chart-machine"');
  expect(markup).toContain('class="chart-reality"');
  expect(markup).toContain('class="chart-ai-band"');
  expect([...markup.matchAll(/class="chart-ai-edge"/gu)]).toHaveLength(2);
  for (const label of ["6 May", "13 May", "20 May", "27 May", "3 Jun"]) {
    expect(markup).toContain(`>${label}</text>`);
  }
  expect(markup).not.toContain("28 May to 3 Jun 2026");
  for (const label of ["−21 d", "−14 d", "−7 d", "+7"])
    expect(markup).not.toContain(`>${label}</text>`);
});

test.each([50, 98, 0])("endpoints within 4 px keep 24 px label spacing near value %s", (value) => {
  const values = (offset: number) => Array.from({ length: 7 }, () => value + offset);
  const markup = render({
    ...newYork("idle"),
    yDomain: [0, 100],
    player: { path: values(0), band: { lower: values(-1), upper: values(1) } },
    model: { median: values(1), interval: { lower: values(0), upper: values(2) } },
    real: values(0.5),
  });
  const labels = endLabels(markup);
  expect(labels).toHaveLength(3);
  expect(labels.map(({ name }) => name)).toEqual(["AI", "Real", "You"]);
  expect(labels.every(({ x, y }) => x === 296 && y >= 28 && y <= 284)).toBe(true);
  expect((labels[1]?.y ?? 0) - (labels[0]?.y ?? 0)).toBe(24);
  expect((labels[2]?.y ?? 0) - (labels[1]?.y ?? 0)).toBe(24);
  if (value === 50) {
    // At 2.8 px per unit, the three true endpoints span only 2.8 px.
    expect(markup).toContain('class="chart-connector chart-ai-connector" d="M284,149.2L296,149.2"');
    expect(markup).toContain(
      'class="chart-connector chart-real-connector" d="M284,150.6L296,173.2"',
    );
    expect(markup).toContain('class="chart-connector chart-you-connector" d="M284,152L296,197.2"');
  }
});

test("a twentyfold reality spike is redrawn inside the plot with headroom", () => {
  const markup = render({ ...newYork("idle"), yDomain: [0, 10], real: [5, 5, 5, 200, 5, 5, 5] });
  // The extended domain is [0, 210]; 200 maps to 12 + 280 * 10 / 210 = 25.33 px.
  expect(markup).toMatch(/class="chart-day-ring" cx="[\d.]+" cy="25.33"/u);
});

test("a domain that crosses zero labels the zero tick without a minus sign", () => {
  const markup = render({ ...newYork("idle"), yDomain: [-3.04, 10.64] });
  expect(markup).toContain(">0</text>");
  expect(markup).not.toMatch(/>[-−]0<\/text>/u);
});

test("labels are escaped as text and invalid series lengths fail loudly", () => {
  const state = newYork("idle");
  expect(render({ ...state, label: '<img src="x">&' })).toContain(
    "&#60;img src=&#34;x&#34;&#62;&#38;",
  );
  expect(() => render({ ...state, visible: [1, 2] })).toThrow("requires 28 days");
  expect(() => render({ ...state, real: [1, 2] })).toThrow("requires 7 days");
});

test("drawing hooks share the chart geometry and replace only the player layers", () => {
  const slot = { innerHTML: "" };
  const drawing = renderChart({ ...newYork("idle"), yDomain: [0, 100] }, slot);
  expect(drawing.today).toBeCloseTo(193.72);
  expect(drawing.right).toBe(284);
  expect(drawing.top).toBe(12);
  expect(drawing.bottom).toBe(292);
  expect(drawing.dayXs.at(-1)).toBe(284);
  expect(drawing.y(100)).toBe(12);
  expect(drawing.valueAtY(292)).toBe(0);
  const layers = new Map([
    ["[data-player-band]", { innerHTML: "" }],
    ["[data-player-edges]", { innerHTML: "" }],
    ["[data-player-ink]", { innerHTML: "" }],
    ["[data-player-label]", { innerHTML: "" }],
  ]);
  const target = { querySelector: (selector: string) => layers.get(selector) ?? null };
  const before = slot.innerHTML;
  drawing.player(target, [10, 20, 30, 40, 50, 60, 70], 2);
  // 2.8 px per unit, 90.28/7 px per day, anchored at today's 22.6.
  expect(layers.get("[data-player-band]")?.innerHTML).toBe(
    '<path class="chart-you-band" d="M193.72,228.72L206.62,258.4L219.51,230.4L232.41,202.4L245.31,174.4L258.21,146.4L271.1,118.4L284,90.4L284,101.6L271.1,129.6L258.21,157.6L245.31,185.6L232.41,213.6L219.51,241.6L206.62,269.6Z"/>',
  );
  expect(layers.get("[data-player-edges]")?.innerHTML).toContain(
    'class="chart-you-edge" d="M193.72,228.72L206.62,258.4',
  );
  expect(layers.get("[data-player-label]")?.innerHTML).toBe(
    '<path class="chart-connector chart-you-connector" d="M284,96L296,96"/><text x="296" y="100" class="chart-end-label chart-you-label" text-anchor="start">You</text>',
  );
  expect(layers.get("[data-player-ink]")?.innerHTML).toMatch(/class="chart-gesture" d="M[^N]+Z"/u);
  expect(slot.innerHTML).toBe(before);
});

test("gap days push the seven forecast days right and leave today where it was", () => {
  const plain = renderChart(newYork("idle"), { innerHTML: "" });
  const gapped = renderChart({ ...newYork("idle"), gapDays: 3 }, { innerHTML: "" });
  const span = plain.right - plain.today;
  expect(gapped.today).toBe(plain.today);
  expect(gapped.dayXs).toHaveLength(7);
  gapped.dayXs.forEach((x, index) => {
    expect(x).toBeCloseTo(plain.today + (span * (index + 4)) / 10);
  });
  expect(gapped.dayXs.at(-1)).toBe(plain.right);
  expect(plain.lastDay).toBe(7);
  expect(gapped.lastDay).toBe(10);
  expect(render({ ...newYork("idle"), gapDays: 3 })).toContain(">+10</text>");
  expect(render(newYork("idle"))).toContain(">+7</text>");
});

test("stationary and repeated raw points produce finite ink anchored at today", () => {
  const drawing = renderChart(newYork("idle"), { innerHTML: "" });
  const ink = { innerHTML: "" };
  const target = { querySelector: () => ink };
  drawing.raw(target, [
    [193.72, drawing.y(22.6)],
    [193.72, drawing.y(22.6)],
  ]);
  expect(ink.innerHTML).toMatch(/class="chart-gesture" d="M[^N]+Z"/u);
  expect(ink.innerHTML).not.toContain("Infinity");
  drawing.raw(target, [
    [220, 100],
    [250, 120],
  ]);
  const outline = ink.innerHTML.match(/d="([^"]+)"/u)?.[1] ?? "";
  const firstX = Number(outline.slice(1).split(",")[0]);
  // The tapered 1.2 px tip sits within 0.6 px of today's centre.
  expect(Math.abs(firstX - 193.72)).toBeLessThanOrEqual(0.6);
});
