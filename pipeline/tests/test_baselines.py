from collections.abc import Callable, Sequence
from math import inf, nan, sqrt

import pytest
from forecastle_pipeline.core.baselines import flat, seasonal_naive_7
from forecastle_pipeline.core.scoring import typical_move
from forecastle_pipeline.forecasters.base import Forecast

type Baseline = Callable[[Sequence[float], int], Forecast]


def test_flat_bands_use_only_visible_moves_and_one_based_horizon() -> None:
    history = [1.0, 3.0, 2.0, 6.0]
    result = flat(history, 10)
    assert result["median"] == [6.0] * 10
    for day in range(1, 11):
        width = typical_move(history) * 1.2816 * sqrt(day)
        assert result["q10"][day - 1] == pytest.approx(6.0 - width)
        assert result["q90"][day - 1] == pytest.approx(6.0 + width)
    assert flat(history, 10) == result
    assert history == [1.0, 3.0, 2.0, 6.0]


def test_seasonal_forecast_recurs_beyond_first_week() -> None:
    history = [100.0, 200.0, *map(float, range(7))]
    result = seasonal_naive_7(history, 17)
    assert result["median"] == list(map(float, [*range(7), *range(7), 0, 1, 2]))
    assert history == [100.0, 200.0, *map(float, range(7))]
    for day, median in enumerate(result["median"], start=1):
        width = typical_move(history) * 1.2816 * sqrt(day)
        assert result["q10"][day - 1] == pytest.approx(median - width)
        assert result["q90"][day - 1] == pytest.approx(median + width)
    assert seasonal_naive_7(history, 17) == result


@pytest.mark.parametrize("baseline", [flat, seasonal_naive_7])
def test_constant_series_has_positive_finite_bands(baseline: Baseline) -> None:
    result = baseline([0.0] * 28, 7)
    assert result["median"] == [0.0] * 7
    assert all(lower < 0 < upper for lower, upper in zip(result["q10"], result["q90"], strict=True))


@pytest.mark.parametrize("baseline", [flat, seasonal_naive_7])
@pytest.mark.parametrize("history", [[], [1.0], [nan] * 28, [inf] * 28])
def test_rejects_short_or_nonfinite_history(baseline: Baseline, history: list[float]) -> None:
    with pytest.raises(ValueError, match=r"Require|finite"):
        baseline(history, 7)


@pytest.mark.parametrize("baseline", [flat, seasonal_naive_7])
@pytest.mark.parametrize("horizon", [0, -1])
def test_rejects_nonpositive_horizon(baseline: Baseline, horizon: int) -> None:
    with pytest.raises(ValueError, match="positive horizon"):
        baseline([1.0] * 28, horizon)


def test_seasonal_needs_a_full_week() -> None:
    with pytest.raises(ValueError, match="at least 7"):
        seasonal_naive_7([1.0] * 6, 7)
