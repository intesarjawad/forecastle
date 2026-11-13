from __future__ import annotations

import json
from dataclasses import dataclass, field
from importlib.resources import files
from math import isfinite
from typing import TYPE_CHECKING, Literal, TypedDict

import numpy as np

if TYPE_CHECKING:
    from collections.abc import Sequence

    from chronos import Chronos2Pipeline

    from forecastle_pipeline.forecasters.base import Forecast

ModelName = Literal["chronos-2", "chronos-2-small", "chronos-2-long"]


class ModelLock(TypedDict):
    """Pinned repository identity and download checksums shipped with the package."""

    revision: str
    license: str
    files: dict[str, str]


@dataclass
class Chronos2Forecaster:
    """CPU float32 inference with an explicit trailing context and pinned weights."""

    name: str
    repo_id: str
    revision: str
    context_length: int
    _pipeline: Chronos2Pipeline = field(init=False, repr=False)

    def __post_init__(self) -> None:
        if self.context_length < 1:
            msg = "Context length must be positive"
            raise ValueError(msg)
        import torch  # noqa: PLC0415 - keep model dependencies out of CLI help.
        from chronos import Chronos2Pipeline  # noqa: PLC0415

        self._pipeline = Chronos2Pipeline.from_pretrained(
            self.repo_id, revision=self.revision, device_map="cpu", dtype=torch.float32
        )

    def forecast(self, visible: Sequence[float], horizon: int) -> Forecast:
        """Use the trailing context, rejecting incomplete histories or invalid output."""
        if len(visible) < self.context_length or horizon < 1:
            msg = f"Require at least {self.context_length} visible values and a positive horizon"
            raise ValueError(msg)
        history = np.asarray(visible[-self.context_length :], dtype=np.float32)
        if not np.isfinite(history).all():
            msg = "Visible context must contain finite float32 values"
            raise ValueError(msg)
        quantiles, _ = self._pipeline.predict_quantiles(
            [history], prediction_length=horizon, quantile_levels=[0.1, 0.5, 0.9]
        )
        if len(quantiles) != 1 or tuple(quantiles[0].shape) != (1, horizon, 3):
            msg = f"{self.name} returned quantiles with an unexpected shape"
            raise ValueError(msg)
        q10 = [float(value) for value in quantiles[0][0, :, 0]]
        median = [float(value) for value in quantiles[0][0, :, 1]]
        q90 = [float(value) for value in quantiles[0][0, :, 2]]
        if not all(isfinite(value) for value in (*q10, *median, *q90)):
            msg = f"{self.name} returned nonfinite quantiles"
            raise ValueError(msg)
        if not all(low <= mid <= high for low, mid, high in zip(q10, median, q90, strict=True)):
            msg = f"{self.name} returned unordered quantiles"
            raise ValueError(msg)
        return {"median": median, "q10": q10, "q90": q90}


def load_forecaster(name: ModelName) -> Chronos2Forecaster:
    """Load one benchmark configuration using the model lock bundled in the wheel."""
    configurations = {
        "chronos-2": ("amazon/chronos-2", 28),
        "chronos-2-small": ("autogluon/chronos-2-small", 28),
        "chronos-2-long": ("amazon/chronos-2", 365),
    }
    repo_id, context_length = configurations[name]
    models: dict[str, ModelLock] = json.loads(
        files("forecastle_pipeline").joinpath("models.lock.json").read_text(encoding="utf-8")
    )
    return Chronos2Forecaster(name, repo_id, models[repo_id]["revision"], context_length)
