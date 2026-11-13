import { sampleStroke } from "../core/sampling";
import type { YDomain } from "../core/y-scale";

type StrokePoint = { readonly x: number; readonly y: number };
type Point = readonly [number, number];
type Layers = { querySelector: (selector: string) => Pick<Element, "innerHTML"> | null };

/**
 * Where a drawing lives. The value axis runs up the screen on the chart and across it on
 * the lesson sheet, so the surface owns every conversion between pixels and days.
 */
export type DrawSurface = {
  readonly region: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  /** The direction a value moves on screen, which is also the handles' slider orientation. */
  readonly orientation: "vertical" | "horizontal";
  readonly lastDay: number;
  /** Day 0 is today; day 7 is the last scored day. */
  readonly pixel: (day: number, value: number) => Point;
  readonly toStroke: (pixelX: number, pixelY: number) => StrokePoint;
  readonly player: (svg: Layers, values: readonly number[], halfWidth: number) => void;
  readonly raw: (svg: Layers, points: readonly Point[]) => void;
};
export type DrawState = {
  readonly points: readonly StrokePoint[];
  readonly values: readonly number[] | null;
  readonly missing: "start" | "end" | null;
};
type DrawOptions = {
  readonly start: number;
  readonly yDomain: YDomain;
  readonly typicalMove: number;
  readonly unit: string;
  readonly halfWidth: () => number;
  readonly guidance: HTMLElement;
};

const DAY_XS = [1, 2, 3, 4, 5, 6, 7];
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const clamp = (value: number, [lower, upper]: YDomain) => Math.max(lower, Math.min(upper, value));

/**
 * Unfinished samples survive between gestures. Once complete, daily knots keep
 * later gestures from moving days outside their horizontal span.
 */
export function mergeDrawStroke(
  previous: DrawState,
  stroke: readonly StrokePoint[],
  start: number,
  domain: YDomain,
): DrawState {
  if (stroke.length === 0) return previous;
  const left = Math.min(...stroke.map(({ x }) => x));
  const right = Math.max(...stroke.map(({ x }) => x));
  const points = [
    ...previous.points.filter(({ x }) => x < left).sort((a, b) => a.x - b.x),
    ...stroke,
    ...previous.points.filter(({ x }) => x > right).sort((a, b) => a.x - b.x),
  ];
  const sampled = sampleStroke(points, DAY_XS, domain);
  if (!Array.isArray(sampled)) return { points, values: null, missing: sampled.missing };
  const values = sampled.map((value, index) => {
    const day = DAY_XS[index] ?? 0;
    return day < left || day > right ? (previous.values?.[index] ?? value) : value;
  });
  return {
    points: [{ x: 0, y: start }, ...values.map((y, index) => ({ x: index + 1, y }))],
    values,
    missing: null,
  };
}

/**
 * Return null for keys that belong to normal button or page navigation. Left and right
 * move a value only where the value axis runs across the screen.
 */
export function keyboardDrawValue(
  value: number,
  key: string,
  shift: boolean,
  typicalMove: number,
  domain: YDomain,
  orientation: DrawSurface["orientation"] = "vertical",
): number | null {
  const step = typicalMove * (shift ? 2 : 0.5);
  const across = orientation === "horizontal";
  switch (key) {
    case "ArrowUp":
      return clamp(value + step, domain);
    case "ArrowDown":
      return clamp(value - step, domain);
    case "ArrowRight":
      return across ? clamp(value + step, domain) : null;
    case "ArrowLeft":
      return across ? clamp(value - step, domain) : null;
    case "Home":
      return domain[0];
    case "End":
      return domain[1];
    default:
      return null;
  }
}

/**
 * Own drawing input independently of puzzle loading, time, and persistence.
 * Keyboard days start at today's value so unedited days stay level.
 */
export function createDrawing(options: DrawOptions, onChange: (values: readonly number[]) => void) {
  const { start, yDomain, typicalMove, unit, halfWidth } = options;
  const format = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
  let state: DrawState = { points: [], values: null, missing: null };
  let started = false;
  let active = false;
  let unmount = () => {};

  // Stable nodes keep keyboard focus and in-flight accessibility reads across repaints.
  const hit = document.createElementNS(SVG_NAMESPACE, "rect");
  hit.classList.add("draw-region");
  hit.setAttribute("aria-hidden", "true");
  const handles = document.createElement("div");
  handles.className = "draw-handles";
  handles.setAttribute("role", "group");
  handles.setAttribute("aria-label", "Draw the next 7 days with the arrow keys");
  const hint = document.createElement("p");
  hint.className = "draw-hint";
  hint.setAttribute("role", "status");
  const buttons = DAY_XS.map((day) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "draw-handle";
    button.setAttribute("role", "slider");
    button.setAttribute("aria-label", `Day ${day}`);
    button.setAttribute("aria-valuemin", String(yDomain[0]));
    button.setAttribute("aria-valuemax", String(yDomain[1]));

    handles.append(button);
    return button;
  });

  return {
    active: () => active,
    /** Reattach after a chart resize, preserving samples and daily values. */
    mount(target: HTMLElement, surface: DrawSurface): void {
      unmount();
      const svg = target.querySelector("svg");
      if (!svg) throw new Error("Drawing requires a rendered chart.");
      for (const [name, value] of Object.entries(surface.region))
        hit.setAttribute(name, String(value));
      svg.append(hit);

      buttons.forEach((button, index) => {
        const day = index + 1;
        button.setAttribute("aria-orientation", surface.orientation);
        button.onkeydown = (event) => {
          const values = [...(state.values ?? DAY_XS.map(() => start))];
          const value = keyboardDrawValue(
            values[day - 1] ?? start,
            event.key,
            event.shiftKey,
            typicalMove,
            yDomain,
            surface.orientation,
          );
          if (value === null) return;
          event.preventDefault();
          values[day - 1] = value;
          state = {
            values,
            points: [{ x: 0, y: start }, ...values.map((y, index) => ({ x: index + 1, y }))],
            missing: null,
          };
          started = true;
          onChange(values);
          schedule();
        };
      });
      target.append(handles);
      options.guidance.prepend(hint);

      // Cache the inverse outside input handlers; scrolling refreshes it before the next gesture.
      let inverse = new DOMMatrix();
      const refreshTransform = () => {
        const matrix = svg.getScreenCTM();
        // Some engines return an SVGMatrix here, which has no transformPoint.
        if (matrix) inverse = DOMMatrix.fromMatrix(matrix).inverse();
      };
      refreshTransform();
      let transformFrame = 0;
      const onScroll = () => {
        if (!transformFrame)
          transformFrame = requestAnimationFrame(() => {
            transformFrame = 0;
            refreshTransform();
          });
      };
      window.addEventListener("scroll", onScroll, { capture: true, passive: true });
      let pointerId: number | null = null;
      let stroke: StrokePoint[] = [];
      let frame = 0;
      const pixelPoints = (points: readonly StrokePoint[]) =>
        points.map(({ x, y }) => surface.pixel(x, y));
      const paint = () => {
        frame = 0;
        if (started) {
          svg.querySelector("[data-draw-idle]")?.remove();
          svg.querySelector(".chart-empty")?.remove();
        }
        if (state.values) surface.player(svg, state.values, halfWidth());
        if (stroke.length) {
          const left = Math.min(...stroke.map(({ x }) => x));
          const right = Math.max(...stroke.map(({ x }) => x));
          surface.raw(
            svg,
            pixelPoints([
              ...state.points.filter(({ x }) => x < left).sort((a, b) => a.x - b.x),
              ...stroke,
              ...state.points.filter(({ x }) => x > right).sort((a, b) => a.x - b.x),
            ]),
          );
        } else if (!state.values && state.points.length)
          surface.raw(svg, pixelPoints(state.points));
        hint.textContent =
          state.missing === "start"
            ? "Start at today. Keep drawing."
            : state.missing === "end"
              ? `Keep drawing to +${surface.lastDay}.`
              : "";
        hint.hidden = hint.textContent === "";
        buttons.forEach((button, index) => {
          const value = state.values?.[index] ?? start;
          button.setAttribute("aria-valuenow", String(value));
          button.setAttribute("aria-valuetext", `${format.format(value)} ${unit}`.trim());
          const [left, top] = surface.pixel(index + 1, value);
          button.style.left = `${left}px`;
          button.style.top = `${top}px`;
        });
      };
      function schedule() {
        if (!frame) frame = requestAnimationFrame(paint);
      }
      const append = (event: PointerEvent) => {
        const point = inverse.transformPoint({ x: event.clientX, y: event.clientY });
        const sample = surface.toStroke(point.x, point.y);
        stroke.push({ x: clamp(sample.x, [0, 7]), y: clamp(sample.y, yDomain) });
        schedule();
      };
      const finish = () => {
        state = mergeDrawStroke(state, stroke, start, yDomain);
        stroke = [];
        pointerId = null;
        active = false;
        if (state.values) onChange(state.values);
        schedule();
      };
      hit.onpointerdown = (event) => {
        if (pointerId !== null || !event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        pointerId = event.pointerId;
        active = true;
        started = true;
        state = { ...state, missing: null };
        stroke = [];
        // A resize or late font load can move the chart without a scroll; one read per gesture is cheap.
        refreshTransform();
        // Synthetic pointer events have no active pointer to capture.
        if (event.isTrusted) hit.setPointerCapture(event.pointerId);
        append(event);
      };
      hit.onpointermove = (event) => {
        if (event.pointerId === pointerId) append(event);
      };
      hit.onpointerup = (event) => {
        if (event.pointerId !== pointerId) return;
        append(event);
        finish();
        if (hit.hasPointerCapture(event.pointerId)) hit.releasePointerCapture(event.pointerId);
      };
      // Keep interrupted gestures so a cancelled touch can be continued.
      const interrupted = (event: PointerEvent) => {
        if (event.pointerId === pointerId) finish();
      };
      hit.onpointercancel = interrupted;
      hit.onlostpointercapture = interrupted;
      paint();
      unmount = () => {
        // A resize can replace the capture target mid-gesture.
        if (pointerId !== null) finish();
        cancelAnimationFrame(frame);
        cancelAnimationFrame(transformFrame);
        window.removeEventListener("scroll", onScroll, true);
        hit.remove();
        handles.remove();
        hint.remove();
      };
    },
    destroy(): void {
      unmount();
    },
  };
}
