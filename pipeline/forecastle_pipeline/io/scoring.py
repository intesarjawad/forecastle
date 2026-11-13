from collections.abc import Sequence
from math import isfinite
from typing import TypedDict

from forecastle_pipeline.core.scoring import Interval

# Mirrored in TypeScript: headroom for differences, sums, k * move and loss normalization.
MAX_ABSOLUTE_VALUE = 1e100
HORIZON = 7
MIN_VISIBLE_VALUES = 2


class ScoringInput(TypedDict):
    """Numeric inputs decoded at ingestion, before scoring."""

    visible: Sequence[float]
    path: Sequence[float]
    interval: Interval
    actual: Sequence[float]
    k: float


def validate_scoring_input(scoring_input: ScoringInput) -> None:
    """Require aligned inputs with finite magnitudes <= 1e100 and positive k <= 1e100."""
    series = (
        ("visible", scoring_input["visible"]),
        ("path", scoring_input["path"]),
        ("actual", scoring_input["actual"]),
        ("interval.lower", scoring_input["interval"]["lower"]),
        ("interval.upper", scoring_input["interval"]["upper"]),
    )
    for name, values in series:
        valid_length = (
            len(values) >= MIN_VISIBLE_VALUES if name == "visible" else len(values) == HORIZON
        )
        if not valid_length:
            msg = (
                "visible must contain at least 2 values"
                if name == "visible"
                else f"{name} must contain 7 values"
            )
            raise ValueError(msg)
        if any(
            isinstance(value, bool) or not abs(value) <= MAX_ABSOLUTE_VALUE or not isfinite(value)
            for value in values
        ):
            msg = f"{name} values must be finite with absolute value <= 1e100"
            raise ValueError(msg)
    k = scoring_input["k"]
    if isinstance(k, bool) or not 0 < k <= MAX_ABSOLUTE_VALUE or not isfinite(k):
        msg = "k must be finite and in (0, 1e100]"
        raise ValueError(msg)
