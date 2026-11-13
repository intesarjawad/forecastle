import sys
from math import isfinite, pi, sin
from time import perf_counter
from typing import TYPE_CHECKING

import pytest
from forecastle_pipeline.forecasters.chronos2 import ModelName, load_forecaster

if TYPE_CHECKING:
    from forecastle_pipeline.forecasters.base import Forecaster

MODEL_BUDGET_SECONDS = 120


@pytest.mark.model
@pytest.mark.parametrize("name", ["chronos-2", "chronos-2-small", "chronos-2-long"])
def test_chronos2_smoke(name: ModelName) -> None:
    started = perf_counter()
    model = load_forecaster(name)
    loaded = perf_counter()
    forecaster: Forecaster = model
    visible = [10.0 + 2.0 * sin(day * 2.0 * pi / 7) for day in range(365)]
    prediction_times: list[float] = []
    for horizon in (7, 10):
        before_predict = perf_counter()
        first = forecaster.forecast(visible, horizon)
        second = forecaster.forecast(visible, horizon)
        prediction_times.append(perf_counter() - before_predict)
        assert first == second
        assert set(first) == {"q10", "median", "q90"}
        for path in (first["median"], first["q10"], first["q90"]):
            assert len(path) == horizon
            assert all(type(value) is float and isfinite(value) for value in path)
        assert all(
            low <= median <= high
            for low, median, high in zip(first["q10"], first["median"], first["q90"], strict=True)
        )
    total_seconds = perf_counter() - started
    sys.stdout.write(
        f"{name}: load={loaded - started:.3f}s "
        f"predict7_twice={prediction_times[0]:.3f}s "
        f"predict10_twice={prediction_times[1]:.3f}s total={total_seconds:.3f}s\n"
    )
    assert total_seconds <= MODEL_BUDGET_SECONDS, f"{name} exceeded the 120 s per-model budget"
