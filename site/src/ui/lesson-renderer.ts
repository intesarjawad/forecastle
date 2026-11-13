import type { Stats } from "../core/history";
import type { MatchState } from "../core/state";
import type { Puzzle } from "../io/puzzle-validation";
import type { createDrawing } from "./draw";
import type { Ink } from "./ink";
import { type MatchShell, measureSheet } from "./lesson";
import { renderSheet, type SheetDrawing, weeks } from "./sheet";

type RenderOptions = {
  readonly shell: MatchShell;
  readonly puzzle: Puzzle;
  readonly ink: Ink;
  readonly drawing: ReturnType<typeof createDrawing>;
  readonly state: () => MatchState;
  readonly crowd: () => Stats | null;
  readonly disposed: () => boolean;
};

export function createLessonRenderer(options: RenderOptions) {
  const { shell, puzzle, ink, drawing } = options;
  const lessonRoot = shell.lesson;
  const chartSlot = shell.chart;
  const given = weeks(puzzle.visible);
  const start = puzzle.visible.at(-1);
  if (start === undefined) throw new Error("Drawing requires visible history.");
  let geometry: SheetDrawing | null = null;
  let printedKey = "";
  let interactiveMarked = false;
  let inkFrame = 0;
  let painted = () => {};
  const ready = new Promise<void>((resolve) => {
    painted = resolve;
  });
  /** The crowd median joins the revealed chart; a missing service simply leaves it out. */
  const paintCrowd = () => {
    const chart = geometry;
    const stats = options.crowd();
    const match = options.state();
    if (options.disposed() || match.kind !== "revealed" || chart === null || stats === null) return;
    const svg = chartSlot.querySelector(".chart-svg");
    if (!(svg instanceof SVGSVGElement)) return;
    chart.crowd(svg, stats.median);
    const description = svg.querySelector("desc");
    if (description) {
      const base = (description.textContent ?? "").replace(/ Crowd median from \d+ plays\.$/u, "");
      description.textContent = `${base} Crowd median from ${stats.count} plays.`.trim();
    }
  };

  const render = () => {
    const match = options.state();
    if (options.disposed() || drawing.active()) return;
    const frame = measureSheet(lessonRoot);
    if (!frame.columns.you || frame.width === 0) return;
    // Redrawing replaces the handles, so a focused day keeps its focus across the repaint.
    const focusedDay = chartSlot.contains(document.activeElement)
      ? document.activeElement?.getAttribute("aria-label")
      : null;
    // Locking changes nothing printed on the sheet, so the same frame keeps the same print.
    const printed = JSON.stringify([
      frame.width,
      frame.height,
      frame.columns,
      match.kind === "revealed",
    ]);
    const reprint = printed !== printedKey || geometry === null;
    const sheet =
      !reprint && geometry
        ? geometry
        : renderSheet(
            {
              id: puzzle.id,
              label: puzzle.label,
              unit: puzzle.unit,
              visible: puzzle.visible,
              yDomain: puzzle.yDomain,
              ...(match.kind === "revealed"
                ? {
                    model: {
                      median: puzzle.ai.median,
                      interval: { lower: puzzle.ai.q10, upper: puzzle.ai.q90 },
                    },
                    real: match.answer.actual,
                  }
                : {}),
            },
            frame,
            chartSlot,
            ink,
          );
    geometry = sheet;
    printedKey = printed;
    const paintInk = () => {
      inkFrame = 0;
      if (options.disposed()) return;
      // Phones keep one device pixel per CSS pixel; the ink is soft, and the GPU budget is small.
      ink.resize(
        frame.width,
        frame.height,
        sheet.geometry.phone ? 1 : Math.min(2, devicePixelRatio || 1),
        sheet.region.y + sheet.region.height,
      );
      ink.sheet(sheet.geometry, given, start);
      const current = options.state();
      const forecast = "forecast" in current ? current.forecast : undefined;
      if (forecast) ink.path(forecast.path, forecast.multiplier * puzzle.typicalMove);
      if (!interactiveMarked) {
        interactiveMarked = true;
        performance.mark("forecastle:interactive");
        painted();
      }
    };
    if (interactiveMarked || match.kind === "locked") {
      // A restored result needs mark geometry before its answer can arrive.
      cancelAnimationFrame(inkFrame);
      paintInk();
    } else {
      // The title and measured SVG paint before the first canvas rasterization.
      cancelAnimationFrame(inkFrame);
      inkFrame = requestAnimationFrame(() => {
        inkFrame = requestAnimationFrame(paintInk);
      });
    }
    if (match.kind === "idle" || match.kind === "drawing" || match.kind === "drawn") {
      if (reprint) drawing.mount(chartSlot, sheet);
      if (focusedDay)
        chartSlot
          .querySelector<HTMLElement>(`[aria-label="${CSS.escape(focusedDay)}"]`)
          ?.focus({ focusVisible: true });
    }
    paintCrowd();
  };

  return { render, paintCrowd, ready };
}
