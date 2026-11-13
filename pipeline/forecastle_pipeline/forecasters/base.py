from collections.abc import Sequence
from typing import Protocol, TypedDict


class Forecast(TypedDict):
    """Pointwise median and nominal 80% interval, aligned with future days."""

    median: list[float]
    q10: list[float]
    q90: list[float]


class Forecaster(Protocol):
    """Predict future daily values using only the supplied visible history."""

    name: str

    def forecast(self, visible: Sequence[float], horizon: int) -> Forecast:
        """Return one median and interval per future day."""
        ...
