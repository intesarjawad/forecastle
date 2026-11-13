import models from "../../../pipeline/forecastle_pipeline/models.lock.json";
import constants from "../../../scoring/constants.json";
import { messages } from "./messages";

const MODEL_ID = "amazon/chronos-2";
const MODEL_SOURCE =
  "https://github.com/intesarjawad/forecastle/blob/main/pipeline/forecastle_pipeline/forecasters/chronos2.py";

export type HowFigure = {
  readonly title: string;
  readonly description: string;
  readonly caption: string;
  readonly labels: {
    readonly line: string;
    readonly band: string;
    readonly actual: string;
  };
};

export type HowStep = {
  readonly text: string;
  readonly code: string;
};

export type HowSection = {
  readonly id: string;
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly figure?: HowFigure;
  readonly steps?: readonly HowStep[];
  readonly link?: { readonly href: string; readonly label: string };
};

function fixed(value: number): string {
  return value.toFixed(2);
}

function interval(values: readonly number[]): readonly [number, number] {
  const [low, high] = values;
  if (low === undefined || high === undefined) {
    throw new Error("The k interval needs two bounds.");
  }
  return [low, high];
}

/** The page reads the calibration and model pins at build time, so prose cannot drift from them. */
export function howSections(): readonly HowSection[] {
  const model = models[MODEL_ID];
  if (!model) throw new Error(`The model lock is missing ${MODEL_ID}.`);
  const [low, high] = interval(constants.kInterval);
  return [
    {
      id: "closeness",
      title: messages.how.closeness.title,
      paragraphs: [messages.how.closeness.text],
      figure: messages.how.closeness.figure,
    },
    {
      id: "coverage",
      title: messages.how.coverage.title,
      paragraphs: messages.how.coverage.paragraphs,
    },
    {
      id: "crps",
      title: messages.how.crps.title,
      paragraphs: messages.how.crps.paragraphs,
    },
    {
      id: "k",
      title: messages.how.k.title,
      paragraphs: messages.how.k.paragraphs(fixed(constants.k), fixed(low), fixed(high)),
    },
    {
      id: "ai",
      title: messages.how.ai.title,
      paragraphs: messages.how.ai.paragraphs(MODEL_ID, model.revision),
      link: { href: MODEL_SOURCE, label: messages.how.ai.link },
    },
    {
      id: "sealing",
      title: messages.how.sealing.title,
      paragraphs: messages.how.sealing.paragraphs,
    },
    {
      id: "data",
      title: messages.how.data.title,
      paragraphs: messages.how.data.paragraphs,
      link: { href: "#/data", label: messages.how.data.link },
    },
    {
      id: "run",
      title: messages.how.run.title,
      paragraphs: [messages.how.run.note],
      steps: messages.how.run.steps,
    },
    {
      id: "teacher",
      title: messages.how.teacher.title,
      paragraphs: messages.how.teacher.paragraphs,
    },
  ];
}

function paragraph(className: string, text: string): HTMLParagraphElement {
  const element = document.createElement("p");
  element.className = className;
  element.textContent = text;
  return element;
}

function svgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS("http://www.w3.org/2000/svg", name);
}

function figure(copy: HowFigure): HTMLElement {
  const element = document.createElement("figure");
  element.className = "how-figure";
  const svg = svgElement("svg");
  svg.setAttribute("viewBox", "0 0 320 140");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-labelledby", "how-closeness-title");
  const title = svgElement("title");
  title.id = "how-closeness-title";
  title.textContent = copy.title;
  const description = svgElement("desc");
  description.textContent = copy.description;
  const points = [
    [20, 80],
    [80, 70],
    [140, 75],
    [200, 55],
    [260, 60],
    [300, 50],
  ] as const;
  const band = svgElement("polygon");
  band.setAttribute("class", "how-band");
  band.setAttribute(
    "points",
    [
      ...points.map(([x, y]) => `${x},${y - 30}`),
      ...[...points].reverse().map(([x, y]) => `${x},${y + 30}`),
    ].join(" "),
  );
  const axis = svgElement("line");
  axis.setAttribute("class", "how-axis");
  axis.setAttribute("x1", "20");
  axis.setAttribute("y1", "110");
  axis.setAttribute("x2", "300");
  axis.setAttribute("y2", "110");
  const line = svgElement("polyline");
  line.setAttribute("class", "how-line");
  line.setAttribute("points", points.map(([x, y]) => `${x},${y}`).join(" "));
  const error = svgElement("line");
  error.setAttribute("class", "how-error");
  error.setAttribute("x1", "200");
  error.setAttribute("y1", "55");
  error.setAttribute("x2", "200");
  error.setAttribute("y2", "85");
  const actual = svgElement("circle");
  actual.setAttribute("class", "how-actual");
  actual.setAttribute("cx", "200");
  actual.setAttribute("cy", "85");
  actual.setAttribute("r", "4");
  const bandLabel = svgElement("text");
  bandLabel.setAttribute("class", "how-label");
  bandLabel.setAttribute("x", "24");
  bandLabel.setAttribute("y", "24");
  bandLabel.textContent = copy.labels.band;
  const lineLabel = svgElement("text");
  lineLabel.setAttribute("class", "how-label");
  lineLabel.setAttribute("x", "24");
  lineLabel.setAttribute("y", "76");
  lineLabel.textContent = copy.labels.line;
  const actualLabel = svgElement("text");
  actualLabel.setAttribute("class", "how-label");
  actualLabel.setAttribute("x", "204");
  actualLabel.setAttribute("y", "100");
  actualLabel.textContent = copy.labels.actual;
  svg.append(
    title,
    description,
    band,
    axis,
    line,
    error,
    actual,
    bandLabel,
    lineLabel,
    actualLabel,
  );
  const caption = document.createElement("figcaption");
  caption.textContent = copy.caption;
  element.append(svg, caption);
  return element;
}

function codeBlock(step: HowStep): HTMLElement {
  const block = document.createElement("div");
  block.className = "how-step";
  const pre = document.createElement("pre");
  pre.className = "how-code";
  const code = document.createElement("code");
  code.textContent = step.code;
  pre.append(code);
  block.append(paragraph("page-text", step.text), pre);
  return block;
}

/** Render the explanation from the same constants and pins the game uses. */
export function renderHow(root: HTMLElement): void {
  const page = document.createElement("div");
  page.className = "page-how";
  for (const section of howSections()) {
    const element = document.createElement("section");
    element.className = `how-section how-${section.id}`;
    element.id = `how-${section.id}`;
    const heading = document.createElement("h2");
    heading.textContent = section.title;
    element.append(heading);
    for (const text of section.paragraphs) element.append(paragraph("page-text", text));
    if (section.figure) element.append(figure(section.figure));
    if (section.steps) element.append(...section.steps.map(codeBlock));
    if (section.link) {
      const link = document.createElement("a");
      link.className = "how-link";
      link.href = section.link.href;
      link.textContent = section.link.label;
      element.append(link);
    }
    page.append(element);
  }
  root.replaceChildren(page);
}
