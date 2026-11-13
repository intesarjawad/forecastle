import flatAnswer from "./worst-case/flat-window/answer.json" with { type: "json" };
import flatPuzzle from "./worst-case/flat-window/puzzle.json" with { type: "json" };
import labelAnswer from "./worst-case/long-label/answer.json" with { type: "json" };
import labelPuzzle from "./worst-case/long-label/puzzle.json" with { type: "json" };
import millionsAnswer from "./worst-case/millions/answer.json" with { type: "json" };
import millionsPuzzle from "./worst-case/millions/puzzle.json" with { type: "json" };
import missingPuzzle from "./worst-case/missing-answer/puzzle.json" with { type: "json" };
import negativeAnswer from "./worst-case/negative-temperatures/answer.json" with { type: "json" };
import negativePuzzle from "./worst-case/negative-temperatures/puzzle.json" with { type: "json" };
import spikeAnswer from "./worst-case/spike/answer.json" with { type: "json" };
import spikePuzzle from "./worst-case/spike/puzzle.json" with { type: "json" };

export type WorstCase = {
  readonly name: string;
  readonly puzzle: unknown;
  /** Null keeps the answer offline so the reveal fails after a lock. */
  readonly answer: unknown | null;
};

/** Shapes that tend to break axes, labels and arithmetic, kept as complete puzzles. */
export const worstCases: readonly WorstCase[] = [
  { name: "long-label", puzzle: labelPuzzle, answer: labelAnswer },
  { name: "millions", puzzle: millionsPuzzle, answer: millionsAnswer },
  { name: "negative-temperatures", puzzle: negativePuzzle, answer: negativeAnswer },
  { name: "flat-window", puzzle: flatPuzzle, answer: flatAnswer },
  { name: "spike", puzzle: spikePuzzle, answer: spikeAnswer },
  { name: "missing-answer", puzzle: missingPuzzle, answer: null },
];
