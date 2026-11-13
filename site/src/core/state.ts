/** A validated answer, aligned with the 28 visible and seven forecast days. */
export type Answer = {
  readonly id: string;
  readonly actual: readonly number[];
  readonly dates: readonly string[];
};

export type Forecast = {
  readonly path: readonly number[];
  readonly multiplier: number;
};

export type MatchState =
  | { readonly kind: "idle" }
  | { readonly kind: "drawing"; readonly forecast?: Forecast }
  | { readonly kind: "drawn"; readonly forecast: Forecast }
  | { readonly kind: "locked"; readonly forecast: Forecast }
  | { readonly kind: "revealed"; readonly forecast: Forecast; readonly answer: Answer }
  | { readonly kind: "answerError"; readonly forecast: Forecast };

export type MatchEvent =
  | { readonly type: "drawStart" }
  | { readonly type: "drawComplete"; readonly path: readonly number[] }
  | { readonly type: "drawEnd" }
  | { readonly type: "bandChange"; readonly multiplier: number }
  | { readonly type: "lock" }
  | { readonly type: "answerLoaded"; readonly answer: Answer }
  | { readonly type: "answerFailed" }
  | { readonly type: "retry" };

/** The band opens at two typical moves either side of the path. */
export const DEFAULT_BAND_MULTIPLIER = 2;

/** Ignore out-of-order events; a locked forecast never accepts another edit. */
export function transition(state: MatchState, event: MatchEvent): MatchState {
  switch (event.type) {
    case "drawStart":
      if (state.kind === "idle") return { kind: "drawing" };
      if (state.kind === "drawn") return { kind: "drawing", forecast: state.forecast };
      break;
    case "drawComplete":
      if (
        ["idle", "drawing", "drawn"].includes(state.kind) &&
        event.path.length === 7 &&
        event.path.every(Number.isFinite)
      )
        return {
          kind: "drawn",
          forecast: {
            path: [...event.path],
            multiplier:
              "forecast" in state
                ? (state.forecast?.multiplier ?? DEFAULT_BAND_MULTIPLIER)
                : DEFAULT_BAND_MULTIPLIER,
          },
        };
      break;
    case "drawEnd":
      if (state.kind === "drawing" && state.forecast)
        return { kind: "drawn", forecast: state.forecast };
      break;
    case "bandChange":
      if (state.kind === "drawn" && Number.isFinite(event.multiplier) && event.multiplier > 0)
        return { ...state, forecast: { ...state.forecast, multiplier: event.multiplier } };
      break;
    case "lock":
      if (state.kind === "drawn") return { kind: "locked", forecast: state.forecast };
      break;
    case "answerLoaded":
      if (state.kind === "locked") return { ...state, kind: "revealed", answer: event.answer };
      break;
    case "answerFailed":
      if (state.kind === "locked") return { kind: "answerError", forecast: state.forecast };
      break;
    case "retry":
      if (state.kind === "answerError") return { kind: "locked", forecast: state.forecast };
      break;
  }
  return state;
}
