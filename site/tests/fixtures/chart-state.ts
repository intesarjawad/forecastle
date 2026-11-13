import { parsePuzzle } from "../../src/io/puzzle-validation";
import type { ChartState } from "../../src/ui/chart";
import newYorkAnswer from "./2026-10-21/answer.json";
import newYorkPuzzle from "./2026-10-21/puzzle.json";
import stonehengeAnswer from "./2026-10-22/answer.json";
import stonehengePuzzle from "./2026-10-22/puzzle.json";
import frames from "./frames-data.json";

export type FixtureId = "2026-10-21" | "2026-10-22";
export type ChartPhase = "idle" | "drawn" | "revealed";

export function chartFixture(
  id: FixtureId,
  phase: ChartPhase,
): Omit<ChartState, "width" | "height"> {
  const puzzle = parsePuzzle(id === "2026-10-21" ? newYorkPuzzle : stonehengePuzzle);
  const answer = id === "2026-10-21" ? newYorkAnswer : stonehengeAnswer;
  const frame = frames[id];
  return {
    id,
    label: puzzle.label,
    unit: puzzle.unit,
    visible: puzzle.visible,
    yDomain: puzzle.yDomain,
    ...(phase === "idle"
      ? {}
      : {
          player: {
            path: frame.you.path,
            band: {
              lower: frame.you.path.map((value) => value - frame.you.bandHalfWidth),
              upper: frame.you.path.map((value) => value + frame.you.bandHalfWidth),
            },
          },
        }),
    ...(phase === "revealed"
      ? {
          model: {
            median: frame.ai.median,
            interval: { lower: frame.ai.q10, upper: frame.ai.q90 },
          },
          real: answer.actual,
          dates: answer.dates,
        }
      : {}),
  };
}
