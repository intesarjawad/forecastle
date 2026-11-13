import { type CustomPuzzle, decodeCustomPayload, parseCustomPuzzle } from "../core/custom";
import type { Puzzle } from "../io/puzzle-validation";
import type { PuzzleLoad } from "../io/puzzles";
import type { CustomMatch } from "./daily";
import { type MatchShell, mountMatchShell } from "./lesson";
import { messages } from "./messages";
import { messagePanel, mountPage } from "./page";

/**
 * The shared card only reads the series and forecast fields. A custom link
 * carries no puzzle number or forecast digest, so those placeholders stay unseen.
 */
function customPuzzle(custom: CustomPuzzle): Puzzle {
  return {
    id: "custom",
    number: 0,
    kind: "historical",
    seriesId: "custom",
    label: custom.label,
    unit: custom.unit,
    visible: [...custom.visible],
    typicalMove: custom.typicalMove,
    yDomain: custom.yDomain,
    horizon: 7,
    gapDays: 0,
    ai: {
      forecaster: custom.ai.forecaster,
      revision: custom.ai.revision,
      median: [...custom.ai.median],
      q10: [...custom.ai.q10],
      q90: [...custom.ai.q90],
    },
    forecastSha256: "0".repeat(64),
  };
}

export function renderCustom(
  app: HTMLElement,
  encoded: string,
  showPuzzle: (shell: MatchShell, state: PuzzleLoad, custom: CustomMatch) => void,
): void {
  let custom: CustomPuzzle;
  try {
    custom = parseCustomPuzzle(decodeCustomPayload(encoded));
  } catch {
    const content = mountPage(app, messages.custom.title);
    document.querySelector(".page-title")?.classList.add("custom-title");
    content.append(
      messagePanel(
        messages.custom.damaged(() => {
          location.hash = "#/";
        }),
      ),
    );
    return;
  }
  const shell = mountMatchShell(app);
  showPuzzle(
    shell,
    { kind: "ready", puzzle: customPuzzle(custom) },
    {
      answer: { id: "custom", actual: custom.actual, dates: [] },
      link: location.href,
      source: custom.source,
    },
  );
}
