from collections.abc import Sequence
from math import isfinite, sqrt

from forecastle_pipeline.core.scoring import typical_move
from forecastle_pipeline.forecasters.base import Forecast

SEASON_DAYS = 7
# Standard normal 90th percentile; symmetric bounds cover a nominal 80%.
NORMAL_80_PERCENT_Z = 1.2816


def _validate(visible: Sequence[float], horizon: int, minimum: int) -> None:
    if len(visible) < minimum or horizon < 1:
        msg = f"Require at least {minimum} visible values and a positive horizon"
        raise ValueError(msg)
    if not all(isfinite(value) for value in visible):
        msg = "Visible values must be finite"
        raise ValueError(msg)


def _with_bands(median: list[float], move: float) -> Forecast:
    widths = [move * NORMAL_80_PERCENT_Z * sqrt(day) for day in range(1, len(median) + 1)]
    return {
        "median": median,
        "q10": [value - width for value, width in zip(median, widths, strict=True)],
        "q90": [value + width for value, width in zip(median, widths, strict=True)],
    }


def flat(visible: Sequence[float], horizon: int) -> Forecast:
    """Repeat the last value with random-walk uncertainty from visible daily moves."""
    _validate(visible, horizon, minimum=2)
    return _with_bands([float(visible[-1])] * horizon, typical_move(visible))


def seasonal_naive_7(visible: Sequence[float], horizon: int) -> Forecast:
    """Repeat the last week recursively, widening uncertainty by forecast day."""
    _validate(visible, horizon, minimum=SEASON_DAYS)
    history = list(visible)
    for _ in range(horizon):
        history.append(float(history[-SEASON_DAYS]))
    return _with_bands(history[-horizon:], typical_move(visible))
