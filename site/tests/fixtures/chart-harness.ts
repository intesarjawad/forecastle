import "../../src/styles.css";
import { renderChart } from "../../src/ui/chart";
import { chartFixture } from "./chart-state";

const params = new URLSearchParams(location.search);
const id = params.get("id");
const phase = params.get("state");
if (id !== "2026-10-21" && id !== "2026-10-22") throw new Error("Unknown chart fixture.");
if (phase !== "idle" && phase !== "drawn" && phase !== "revealed")
  throw new Error("Unknown chart state.");
const state = chartFixture(id, phase);
const slot = document.querySelector<HTMLElement>("#chart");
if (!slot) throw new Error("Missing chart slot.");
const target = slot;
for (const [id, value] of [
  ["series-name", state.label],
  ["series-unit", state.unit],
] as const) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}
new ResizeObserver(([entry]) => {
  // Chromium briefly lays the page out in a 1x1 viewport while the full-page screenshot is
  // taken; a slot with no box has nothing to draw, so it waits for a real size, as the app does.
  if (!entry || entry.contentRect.width === 0 || entry.contentRect.height === 0) return;
  renderChart(
    { ...state, width: entry.contentRect.width, height: entry.contentRect.height },
    target,
  );
}).observe(target);
