import type { Cell } from "./types";

// The teacher's marks from the sheet, nijūmaru and maru; a day that earned none is a blank slot.
const CELL_SYMBOLS: Record<Cell, string> = {
  green: "\u25CE",
  yellow: "\u25CB",
  white: "\u25CC",
};

type ShareResult = {
  readonly you: number;
  readonly ai: number;
  readonly youCells: readonly Cell[];
  readonly aiCells: readonly Cell[];
  readonly bandCaught: number;
  readonly link: string;
};

/** Format a resolved daily or custom puzzle for sharing. */
export function shareText(
  result: ShareResult &
    ({ readonly kind: "daily"; readonly number: number } | { readonly kind: "custom" }),
): string {
  const title = result.kind === "daily" ? `#${result.number}` : "custom";
  const grid = (cells: readonly Cell[]) => cells.map((cell) => CELL_SYMBOLS[cell]).join("");
  return [
    `Forecastle ${title}: You ${result.you}, AI ${result.ai}`,
    `You ${grid(result.youCells)}`,
    `AI  ${grid(result.aiCells)}`,
    `Band caught ${result.bandCaught}/7`,
    result.link,
  ].join("\n");
}
