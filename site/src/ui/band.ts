import { DEFAULT_BAND_MULTIPLIER } from "../core/state";

/** Multiples of the puzzle's typical move. */
export const BAND_RANGE = {
  min: 0.25,
  max: 8,
  step: 0.25,
  initial: DEFAULT_BAND_MULTIPLIER,
} as const;

/** Half-width of the band in the puzzle's unit, as read out to assistive tech. */
export function bandValueText(multiplier: number, typicalMove: number, unit: string): string {
  const half = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
    multiplier * typicalMove,
  );
  return `±${half} ${unit}`.trim();
}

/**
 * The multiplier lives in the range input,
 * so the caller decides what the band does with it.
 */
export function createBandControl(
  typicalMove: number,
  unit: string,
  onChange: (multiplier: number) => void,
  id = "band-input",
): HTMLElement {
  const root = document.createElement("div");
  root.className = "band-control";
  const label = document.createElement("label");
  label.className = "band-label";
  label.htmlFor = id;
  label.textContent = "How sure are you?";
  const input = document.createElement("input");
  input.id = id;
  input.className = "band-input";
  input.type = "range";
  input.min = String(BAND_RANGE.min);
  input.max = String(BAND_RANGE.max);
  input.step = String(BAND_RANGE.step);
  input.value = String(BAND_RANGE.initial);
  const wedge = document.createElement("span");
  wedge.className = "band-wedge";
  wedge.setAttribute("aria-hidden", "true");
  const captions = document.createElement("div");
  captions.className = "band-captions";
  captions.setAttribute("aria-hidden", "true");
  for (const text of ["More sure", "Less sure"]) {
    const caption = document.createElement("span");
    caption.textContent = text;
    captions.append(caption);
  }
  const help = document.createElement("p");
  help.className = "band-help";
  help.textContent = "Aim to catch about 8 days in 10";
  const sync = () => {
    input.setAttribute("aria-valuetext", bandValueText(input.valueAsNumber, typicalMove, unit));
  };
  input.addEventListener("input", () => {
    sync();
    onChange(input.valueAsNumber);
  });
  sync();
  root.append(label, wedge, input, captions, help);
  return root;
}
