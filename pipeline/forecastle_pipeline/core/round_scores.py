from collections.abc import Sequence
from statistics import median
from typing import TypedDict

from forecastle_pipeline.core.scoring import (
    Interval,
    closeness,
    coverage,
    quantile_loss,
    typical_move,
    winkler,
)
from forecastle_pipeline.forecasters.base import Forecast


class Scores(TypedDict):
    """Chart metrics; coverage is a fraction and all losses use the opening typicalMove."""

    scaledMae: float
    closeness: float
    coverage: float
    scaledWinkler: float
    scaledQuantileLoss: float


def score_forecast(
    visible: Sequence[float],
    forecast: Forecast,
    actual: Sequence[float],
    k: float,
) -> Scores:
    """Score aligned, validated quantiles on the seven scored days."""
    move = typical_move(visible)
    path = forecast["median"]
    interval: Interval = {"lower": forecast["q10"], "upper": forecast["q90"]}
    return {
        "scaledMae": sum(
            abs(predicted - value) for predicted, value in zip(path, actual, strict=True)
        )
        / len(actual)
        / move,
        "closeness": float(closeness(path, actual, move, k)),
        "coverage": coverage(interval, actual) / len(actual),
        "scaledWinkler": winkler(interval, actual, 0.2) / move,
        "scaledQuantileLoss": quantile_loss(path, interval, actual) / move,
    }


def median_scores(submissions: Sequence[Scores]) -> Scores:
    """Aggregate each metric separately for the median-human row."""
    return {
        "scaledMae": median(item["scaledMae"] for item in submissions),
        "closeness": median(item["closeness"] for item in submissions),
        "coverage": median(item["coverage"] for item in submissions),
        "scaledWinkler": median(item["scaledWinkler"] for item in submissions),
        "scaledQuantileLoss": median(item["scaledQuantileLoss"] for item in submissions),
    }
