import json
import re
from functools import reduce
from operator import add
from pathlib import Path
from typing import TypedDict

import pytest
from forecastle_pipeline.core.scoring import (
    Cell,
    Interval,
    closeness,
    coverage,
    day_cells,
    quantile_loss,
    typical_move,
    winkler,
)
from forecastle_pipeline.io.scoring import ScoringInput, validate_scoring_input
from hypothesis import given, settings
from hypothesis import strategies as st

SCORING_DIR = Path(__file__).resolve().parents[2] / "scoring"
CONSTANTS: dict[str, float] = json.loads((SCORING_DIR / "constants.json").read_text())
K = CONSTANTS["k"]
INTERVAL_ALPHA = 0.2
HORIZON = 7
VALUES = st.lists(st.floats(-1e6, 1e6), min_size=HORIZON, max_size=HORIZON)
MOVES = st.floats(1e-2, 1e6)


class Expected(TypedDict):
    typicalMove: float
    closeness: int
    cells: list[Cell]
    coverage: int
    winkler: float
    quantileLoss: float


class ValidCase(ScoringInput):
    name: str
    expected: Expected


class RejectedCase(ScoringInput):
    name: str
    error: str


ScoringCase = ValidCase | RejectedCase


GOLDEN_CASES: list[ScoringCase] = json.loads((SCORING_DIR / "golden.json").read_text())


def assert_scores(case: ScoringCase, tolerance: float) -> None:
    if "error" in case:
        with pytest.raises(ValueError, match=re.escape(case["error"])):
            validate_scoring_input(case)
        return
    validate_scoring_input(case)
    expected = case["expected"]
    path, actual, interval = case["path"], case["actual"], case["interval"]
    move = typical_move(case["visible"])
    assert move == pytest.approx(expected["typicalMove"], rel=tolerance, abs=0)
    assert closeness(path, actual, move, case["k"]) == expected["closeness"]
    assert day_cells(path, actual, move) == expected["cells"]
    assert coverage(interval, actual) == expected["coverage"]
    assert winkler(interval, actual, INTERVAL_ALPHA) == pytest.approx(
        expected["winkler"], rel=tolerance, abs=0
    )
    assert quantile_loss(path, interval, actual) == pytest.approx(
        expected["quantileLoss"], rel=tolerance, abs=0
    )


@pytest.mark.parametrize("case", GOLDEN_CASES, ids=[case["name"] for case in GOLDEN_CASES])
def test_golden(case: ScoringCase) -> None:
    assert_scores(case, 1e-12)


@pytest.mark.parametrize(
    "value",
    [float("inf"), -float("inf"), float("nan"), 1.0000000000000002e100, -1.0000000000000002e100],
)
def test_rejects_unsafe_path_at_ingestion(value: float) -> None:
    scoring_input: ScoringInput = {
        "visible": [0, 1],
        "path": [value] * HORIZON,
        "actual": [0] * HORIZON,
        "interval": {"lower": [0] * HORIZON, "upper": [1] * HORIZON},
        "k": 4,
    }
    with pytest.raises(ValueError, match="path values must be finite with absolute value <= 1e100"):
        validate_scoring_input(scoring_input)


@pytest.mark.parametrize(("error", "expected"), [(1.5, 63), (3.98, 1)])
def test_rounds_half_scores_upward(error: float, expected: int) -> None:
    assert closeness([error] * HORIZON, [0.0] * HORIZON, 1, 4) == expected


def test_accumulates_left_to_right() -> None:
    assert typical_move([1e16, 0, 1, 2]) == 1e16 / 3


@settings(derandomize=True)
@given(path=VALUES, actual=VALUES, move=MOVES)
def test_closeness_bounds(path: list[float], actual: list[float], move: float) -> None:
    assert 0 <= closeness(path, actual, move, K) <= 100


@settings(derandomize=True)
@given(first=VALUES, second=VALUES, actual=VALUES, move=MOVES)
def test_closeness_non_increasing_in_mae(
    first: list[float], second: list[float], actual: list[float], move: float
) -> None:
    first_mae = reduce(add, [abs(p - a) for p, a in zip(first, actual, strict=True)], 0.0)
    second_mae = reduce(add, [abs(p - a) for p, a in zip(second, actual, strict=True)], 0.0)
    lower, higher = (first, second) if first_mae <= second_mae else (second, first)
    assert closeness(lower, actual, move, K) >= closeness(higher, actual, move, K)


@settings(derandomize=True)
@given(lower=VALUES, upper=VALUES, actual=VALUES)
def test_coverage_bounds(lower: list[float], upper: list[float], actual: list[float]) -> None:
    interval: Interval = {
        "lower": [min(lo, hi) for lo, hi in zip(lower, upper, strict=True)],
        "upper": [max(lo, hi) for lo, hi in zip(lower, upper, strict=True)],
    }
    assert 0 <= coverage(interval, actual) <= HORIZON


@settings(derandomize=True)
@given(path=VALUES, lower=VALUES, upper=VALUES, actual=VALUES)
def test_quantile_loss_nonnegative(
    path: list[float], lower: list[float], upper: list[float], actual: list[float]
) -> None:
    assert quantile_loss(path, {"lower": lower, "upper": upper}, actual) >= 0


@settings(derandomize=True)
@given(path=VALUES, actual=VALUES, move=MOVES, scale=st.floats(1e-2, 1e6))
def test_closeness_scale_invariance(
    path: list[float], actual: list[float], move: float, scale: float
) -> None:
    assert closeness(
        [p * scale for p in path], [a * scale for a in actual], move * scale, K
    ) == closeness(path, actual, move, K)
