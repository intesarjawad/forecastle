from collections.abc import Sequence
from math import inf, nan

import numpy as np
import numpy.typing as npt
import pytest
import torch
from chronos import Chronos2Pipeline
from forecastle_pipeline.forecasters.chronos2 import Chronos2Forecaster, load_forecaster


class QuantilePipeline(Chronos2Pipeline):
    def __init__(self) -> None:
        self.output_quantiles = [torch.tensor([[[1.0, 2.0, 3.0]]]).repeat(1, 7, 1)]
        self.history: list[float] = []
        self.loaded: tuple[str, str, str, torch.dtype] | None = None

    def load(
        self, repo: str, *, revision: str, device_map: str, dtype: torch.dtype
    ) -> Chronos2Pipeline:
        self.loaded = (repo, revision, device_map, dtype)
        return self

    def predict_quantiles(
        self,
        inputs: list[npt.NDArray[np.float32]],
        prediction_length: int,
        quantile_levels: list[float],
    ) -> tuple[list[torch.Tensor], list[torch.Tensor]]:
        assert prediction_length == 7
        assert quantile_levels == [0.1, 0.5, 0.9]
        assert len(inputs) == 1
        assert inputs[0].dtype == np.float32
        self.history = [float(value) for value in inputs[0]]
        return self.output_quantiles, []


@pytest.fixture
def pipeline(monkeypatch: pytest.MonkeyPatch) -> QuantilePipeline:
    model = QuantilePipeline()
    monkeypatch.setattr(Chronos2Pipeline, "from_pretrained", model.load)
    return model


def test_loads_pinned_cpu_model_and_uses_trailing_context(pipeline: QuantilePipeline) -> None:
    model = load_forecaster("chronos-2")
    assert pipeline.loaded == (
        "amazon/chronos-2",
        "29ec3766d36d6f73f0696f85560a422f50e8498c",
        "cpu",
        torch.float32,
    )
    result = model.forecast(list(map(float, range(50))), 7)
    assert pipeline.history == list(map(float, range(22, 50)))
    assert result == {"q10": [1.0] * 7, "median": [2.0] * 7, "q90": [3.0] * 7}


@pytest.mark.parametrize("name", ["chronos-2-small", "chronos-2-long"])
def test_configurations_use_locked_revisions(name: str, pipeline: QuantilePipeline) -> None:
    if name == "chronos-2-small":
        model = load_forecaster("chronos-2-small")
        assert model.context_length == 28
        assert model.repo_id == "autogluon/chronos-2-small"
        assert model.revision == "ddec01313e50b6bc58ebaa92ede81bc24a3d9f9a"
    else:
        model = load_forecaster("chronos-2-long")
        assert model.context_length == 365
        assert model.repo_id == "amazon/chronos-2"
        with pytest.raises(ValueError, match="at least 365"):
            model.forecast([1.0] * 364, 7)
    assert pipeline.loaded is not None


@pytest.mark.parametrize(
    ("history", "horizon"),
    [([1.0] * 27, 7), ([1.0] * 28, 0), ([1.0] * 28, -1), ([nan] * 28, 7), ([inf] * 28, 7)],
)
def test_rejects_invalid_context_and_horizon(
    pipeline: QuantilePipeline, history: Sequence[float], horizon: int
) -> None:
    model = load_forecaster("chronos-2")
    with pytest.raises(ValueError, match=r"Require|finite"):
        model.forecast(history, horizon)
    assert pipeline.history == []


@pytest.mark.parametrize("fault", ["empty", "shape", "nonfinite", "unordered"])
def test_rejects_invalid_model_quantiles(pipeline: QuantilePipeline, fault: str) -> None:
    if fault == "empty":
        pipeline.output_quantiles = []
    elif fault == "shape":
        pipeline.output_quantiles = [torch.zeros(7, 3)]
    elif fault == "nonfinite":
        pipeline.output_quantiles[0][0, 0, 0] = nan
    else:
        pipeline.output_quantiles[0][0, 0, 0] = 4.0
    model = load_forecaster("chronos-2")
    with pytest.raises(ValueError, match=r"shape|nonfinite|unordered"):
        model.forecast([1.0] * 28, 7)


def test_rejects_nonpositive_context_length(pipeline: QuantilePipeline) -> None:
    with pytest.raises(ValueError, match="Context length must be positive"):
        Chronos2Forecaster("invalid", "amazon/chronos-2", "revision", 0)
    assert pipeline.loaded is None
