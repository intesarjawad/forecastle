from collections.abc import Sequence
from functools import reduce
from math import floor, inf
from operator import add
from sys import float_info
from typing import Literal, TypedDict

MAX_CLOSENESS = 100
TYPICAL_MOVE_RANGE_FRACTION = 0.01
YELLOW_MOVE_MULTIPLIER = 2
LOWER_QUANTILE = 0.1
MEDIAN_QUANTILE = 0.5
UPPER_QUANTILE = 0.9
QUANTILE_COUNT = 3

Cell = Literal["green", "yellow", "white"]


class Interval(TypedDict):
    """Pointwise interval bounds aligned with the forecast days."""

    lower: Sequence[float]
    upper: Sequence[float]


# io.scoring validates alignment and finite magnitudes <= 1e100 before scoring.
# Python 3.12 sum compensates rounding; reduce preserves the TypeScript addition order.
def typical_move(visible: Sequence[float]) -> float:
    """Mean absolute daily change, floored by 1% of the range and machine epsilon."""
    differences = [abs(value - visible[index]) for index, value in enumerate(visible[1:])]
    mean = reduce(add, differences, 0.0) / len(differences)
    value_range = max(visible) - min(visible)
    return max(mean, TYPICAL_MOVE_RANGE_FRACTION * value_range, float_info.epsilon)


def closeness(path: Sequence[float], actual: Sequence[float], move: float, k: float) -> int:
    """Return a rounded score from 0 to 100, reaching zero at MAE = k times the move."""
    errors = [
        abs(value - (actual[index] if index < len(actual) else 0))
        for index, value in enumerate(path)
    ]
    mae = reduce(add, errors, 0.0) / len(actual)
    score = MAX_CLOSENESS * max(0, 1 - mae / (k * move))
    # Math.round rounds ties upward, unlike Python's ties-to-even round.
    return floor(score) + int(score - floor(score) >= MEDIAN_QUANTILE)


def day_cells(path: Sequence[float], actual: Sequence[float], move: float) -> list[Cell]:
    """Green includes one typical move; yellow includes two."""
    cells: list[Cell] = []
    for index, value in enumerate(actual):
        error = abs((path[index] if index < len(path) else 0) - value)
        cells.append(
            "green"
            if error <= move
            else "yellow"
            if error <= YELLOW_MOVE_MULTIPLIER * move
            else "white"
        )
    return cells


def coverage(interval: Interval, actual: Sequence[float]) -> int:
    """Count actual values within the interval, including its edges."""
    return len(
        [
            value
            for index, value in enumerate(actual)
            if value >= (interval["lower"][index] if index < len(interval["lower"]) else inf)
            and value <= (interval["upper"][index] if index < len(interval["upper"]) else -inf)
        ]
    )


def winkler(interval: Interval, actual: Sequence[float], alpha: float) -> float:
    """Mean interval width plus miss penalties; alpha is the excluded probability."""
    per_day: list[float] = []
    for index, value in enumerate(actual):
        lower = interval["lower"][index] if index < len(interval["lower"]) else 0
        upper = interval["upper"][index] if index < len(interval["upper"]) else 0
        width = upper - lower
        if value < lower:
            per_day.append(width + (2 / alpha) * (lower - value))
        elif value > upper:
            per_day.append(width + (2 / alpha) * (value - upper))
        else:
            per_day.append(width)
    return reduce(add, per_day, 0.0) / len(per_day)


def quantile_loss(path: Sequence[float], interval: Interval, actual: Sequence[float]) -> float:
    """Mean pinball loss over days and the 0.1, 0.5 and 0.9 quantiles."""

    def pinball(quantile: float, forecast: float, value: float) -> float:
        return max(quantile * (value - forecast), (quantile - 1) * (value - forecast))

    per_day = [
        (
            pinball(
                LOWER_QUANTILE,
                interval["lower"][index] if index < len(interval["lower"]) else 0,
                value,
            )
            + pinball(MEDIAN_QUANTILE, path[index] if index < len(path) else 0, value)
            + pinball(
                UPPER_QUANTILE,
                interval["upper"][index] if index < len(interval["upper"]) else 0,
                value,
            )
        )
        / QUANTILE_COUNT
        for index, value in enumerate(actual)
    ]
    return reduce(add, per_day, 0.0) / len(per_day)
