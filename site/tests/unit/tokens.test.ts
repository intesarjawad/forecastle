import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const css = readFileSync(new URL("../../src/styles.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//gu,
  "",
);
const roots = [...css.matchAll(/:root\s*\{([^{}]*)\}/gu)];
const tokens = new Map(
  roots
    .flatMap((root) => [...(root[1] ?? "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/gu)])
    .map((match) => [match[1] ?? "", match[2]?.trim() ?? ""]),
);
function token(name: string): string {
  const value = tokens.get(name);
  if (!value) throw new Error(`Missing token ${name}`);
  return value;
}

type Triple = readonly [number, number, number];
function rgb(hex: string): Triple {
  if (!/^#[\da-f]{6}$/iu.test(hex)) throw new Error(`Expected hex colour: ${hex}`);
  const channel = (offset: number) => Number.parseInt(hex.slice(offset, offset + 2), 16);
  return [channel(1), channel(3), channel(5)];
}
function linear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
function luminance([r, g, b]: Triple): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
function contrast(a: Triple, b: Triple): number {
  const values = [luminance(a), luminance(b)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}
function resolve(name: string): string {
  const value = token(name);
  const alias = /^var\((--[\w-]+)\)$/u.exec(value);
  return alias?.[1] ? resolve(alias[1]) : value;
}
function lab(hex: string): Triple {
  const [r, g, b] = rgb(hex).map(linear) as unknown as Triple;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
function distance(a: string, b: string): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}
const outsideRoot = css.replace(/:root\s*\{[^{}]*\}/gu, "");
function declarations(body: string): Map<string, string> {
  return new Map(
    [...body.matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)/gu)].map((match) => [
      match[1] ?? "",
      match[2]?.trim() ?? "",
    ]),
  );
}

test("the contrast formula matches reference cases", () => {
  expect(contrast(rgb("#000000"), rgb("#ffffff"))).toBe(21);
  expect(contrast(rgb("#176847"), rgb("#176847"))).toBe(1);
});

test("the root table owns the fixed palette and geometry", () => {
  expect(roots).toHaveLength(1);
  for (const [name, value] of Object.entries({
    "--washi": "#eeede7",
    "--sumi": "#17140f",
    "--usuzumi": "#6b6760",
    "--print": "#55524c",
    "--shu": "#a8350d",
    "--shu-ink": "#df4a1a",
    "--card-width": "576px",
    "--control-height": "44px",
    "--chart-ratio-phone": "83 / 75",
    "--chart-ratio-wide": "16 / 10",
    "--you-coverage-opacity": "0.16",
    "--ai-coverage-opacity": "0.18",
    "--history-fraction": "0.63",
    "--plot-gutter": "48px",
    "--label-gap": "24px",
    "--stroke-history": "2px",
    "--stroke-reality": "4px",
    "--stroke-machine": "2px",
    "--stroke-interval": "1px",
    "--dash-machine": "6px",
    "--dash-machine-gap": "4px",
    "--dash-interval": "2px",
    "--dash-interval-gap": "4px",
  }))
    expect(token(name), name).toBe(value);
  const outside = css.replace(/:root\s*\{[^{}]*\}/gu, "");
  expect(outside).not.toMatch(/--[\w-]+\s*:/u);
  expect(outside).not.toMatch(/#[\da-f]{3,8}\b|\b(?:rgb|hsl|hwb|lab|lch|oklab|oklch|color)\(/iu);
  for (const match of outside.matchAll(/(-?\d*\.?\d+)(px|rem)\b/gu)) {
    expect(match[0], "Only zero and 1px hairlines may be literal").toMatch(
      /^(?:0(?:px|rem)|1px)$/u,
    );
  }
  for (const match of outside.matchAll(/(?:^|[;{}])\s*([\w-]+)\s*:\s*([^;{}]+)/gu)) {
    const property = match[1] ?? "";
    const value = match[2] ?? "";
    if (
      property !== "color-scheme" &&
      /color|background|fill|stroke|border|outline/iu.test(property)
    ) {
      const literals = value
        .replace(/var\(--[\w-]+\)/gu, "")
        .replace(/\b(?:solid|dashed|dotted|none|inherit|currentColor)\b/gu, "")
        .trim();
      expect(literals, `${property}: ${value}`).toBe("");
    }
    if (property === "font-size") expect(value.trim()).toMatch(/^var\(--text-[\w-]+\)$/u);
    if (/duration|delay/u.test(property)) expect(value.trim()).toMatch(/^var\(--[\w-]+\)$/u);
  }
  const sizes = [...tokens].filter(([name]) => name.startsWith("--text-"));
  expect(sizes.map(([, value]) => Number.parseFloat(value)).sort((a, b) => a - b)).toEqual([
    12, 14, 16, 24, 32,
  ]);
  for (const [name, value] of tokens) {
    if (
      name.startsWith("--space-") ||
      [
        "--card-gutter",
        "--control-height",
        "--series-height",
        "--plot-gutter",
        "--label-gap",
      ].includes(name)
    ) {
      expect(value, name).toMatch(/^\d+px$/u);
      expect(Number.parseFloat(value) % 4, name).toBe(0);
    }
  }
});

test.each([
  ["--sumi", "--washi", 15.66],
  ["--print", "--washi", 6.64],
  ["--shu", "--washi", 5.63],
])("%s on %s meets text contrast", (foreground, background, expected) => {
  const ratio = contrast(rgb(token(String(foreground))), rgb(token(String(background))));
  expect(ratio).toBeGreaterThanOrEqual(4.5);
  expect(Math.abs(ratio - Number(expected))).toBeLessThan(0.025);
});

test("multiply overprint preserves text and line contrast", () => {
  const stock = rgb(token("--washi"));
  const you = rgb(token("--sumi"));
  const ai = rgb(token("--print"));
  const blend = (base: number, human: number, model: number) =>
    base *
    (1 - Number(token("--you-coverage-opacity")) * (1 - human / 255)) *
    (1 - Number(token("--ai-coverage-opacity")) * (1 - model / 255));
  const overprint: Triple = [
    blend(stock[0], you[0], ai[0]),
    blend(stock[1], you[1], ai[1]),
    blend(stock[2], you[2], ai[2]),
  ];
  for (const [foreground, expected, minimum] of [
    [you, 8.59, 4.5],
    [ai, 3.64, 3],
    [rgb(token("--shu")), 3.09, 3],
  ] as const) {
    const ratio = contrast(foreground, overprint);
    expect(ratio).toBeGreaterThanOrEqual(minimum);
    expect(Math.abs(ratio - expected)).toBeLessThan(0.025);
  }
});

// Each pair is a foreground drawn on a background somewhere in the stylesheet.
// The ratios are computed outside this file from the hex values.
const textPairs = [
  ["--sumi", "--washi", 15.66],
  ["--print", "--washi", 6.64],
  ["--shu", "--washi", 5.63],
  ["--washi", "--sumi", 15.66],
  ["--washi", "--print", 6.64],
] as const;
// The brushed inks: the teacher's vermilion strokes and the dilute sumi at a wash's wet edge.
const nonTextPairs = [
  ["--sumi", "--washi", 15.66],
  ["--shu-ink", "--washi", 3.49],
  ["--usuzumi", "--washi", 4.79],
  ["--ink-focus", "--washi", 5.63],
] as const;

test.each([
  ...textPairs.map(
    ([foreground, background, expected]) =>
      ["text", 4.5, foreground, background, expected] as const,
  ),
  ...nonTextPairs.map(
    ([foreground, background, expected]) =>
      ["non-text", 3, foreground, background, expected] as const,
  ),
])("%s pair at %s:1, %s on %s", (_kind, minimum, foreground, background, expected) => {
  const ratio = contrast(rgb(resolve(foreground)), rgb(resolve(background)));
  expect(ratio).toBeGreaterThanOrEqual(minimum);
  expect(Math.abs(ratio - expected)).toBeLessThan(0.025);
});

test("every colour token and every colour pair in a rule is in the pair table", () => {
  const pairs = [...textPairs, ...nonTextPairs];
  const listed = new Set<string>([...pairs.map(([fg]) => fg), ...pairs.map(([, bg]) => bg)]);
  for (const [name, value] of tokens)
    if (/^#[\da-f]{6}$/iu.test(value)) expect(listed.has(name), name).toBe(true);
  const known = new Set(textPairs.map(([fg, bg]) => `${fg}/${bg}`));
  for (const rule of outsideRoot.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    const body = declarations(rule[2] ?? "");
    const foreground = /^var\((--[\w-]+)\)$/u.exec(body.get("color") ?? "")?.[1];
    const background = /^var\((--[\w-]+)\)$/u.exec(
      body.get("background") ?? body.get("background-color") ?? "",
    )?.[1];
    if (foreground && background && background !== "--clear")
      expect(known.has(`${foreground}/${background}`), `${rule[1]?.trim()}`).toBe(true);
  }
});

test("the colour distance matches reference cases", () => {
  expect(distance("#000000", "#ffffff")).toBeCloseTo(100, 2);
  // Pure red is L 53.24, a 80.09, b 67.20; white is L 100.
  expect(distance("#ff0000", "#ffffff")).toBeCloseTo(114.53, 1);
});

// The defaults a generated page falls into: teal and purple accents on a cream ground.
const accentTells = [
  "#0f766e",
  "#0d9488",
  "#14b8a6",
  "#6366f1",
  "#7c3aed",
  "#8b5cf6",
  "#9333ea",
  "#a855f7",
];
const groundTells = ["#f5f0e6", "#faf3e0", "#fdf6e3"];
// A CIELAB distance of 15 sits below the vermilions' closest approach, 91.4.
const ACCENT_TELL_MIN = 15;
// Washi sits near cream in lightness, so the guard is its yellowness: the tells start at b* 5.4.
const GROUND_YELLOW_MAX = 4;

test("the inks keep their distance from the default accents, and the paper is not cream", () => {
  for (const ink of ["--shu", "--shu-ink"])
    for (const tell of accentTells)
      expect(distance(token(ink), tell), `${ink} against ${tell}`).toBeGreaterThanOrEqual(
        ACCENT_TELL_MIN,
      );
  for (const tell of groundTells) expect(lab(tell)[2], tell).toBeGreaterThan(GROUND_YELLOW_MAX);
  for (const ground of ["--washi"])
    expect(lab(token(ground))[2], ground).toBeLessThanOrEqual(GROUND_YELLOW_MAX);
});

test("sumi and vermilion stay clearly apart", () => {
  expect(distance(token("--sumi"), token("--shu"))).toBeGreaterThanOrEqual(40);
});

test("weights, leading, radii and stroke widths come from tokens", () => {
  for (const [property, pattern] of [
    ["font-weight", /^var\(--weight-[\w-]+\)$/u],
    ["line-height", /^var\(--leading-[\w-]+\)$/u],
    ["border-radius", /^var\(--radius-[\w-]+\)$/u],
    ["stroke-width", /^var\(--[\w-]+\)$/u],
  ] as const)
    for (const rule of outsideRoot.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
      const value = rule[1]?.includes("@font-face")
        ? undefined
        : declarations(rule[2] ?? "").get(property);
      if (value !== undefined) expect(value, `${rule[1]?.trim()} ${property}`).toMatch(pattern);
    }
});
