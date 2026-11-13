import numpy as np
import numpy.typing as npt
import torch

class Chronos2Pipeline:
    @classmethod
    def from_pretrained(
        cls,
        pretrained_model_name_or_path: str,
        *,
        revision: str,
        device_map: str,
        dtype: torch.dtype,
    ) -> Chronos2Pipeline: ...
    def predict_quantiles(
        self,
        inputs: list[npt.NDArray[np.float32]],
        prediction_length: int,
        quantile_levels: list[float],
    ) -> tuple[list[torch.Tensor], list[torch.Tensor]]: ...
