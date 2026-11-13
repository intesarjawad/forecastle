"""Export the benchmark as a fev task, load it with fev and print seasonal-naive scores."""

import argparse
from importlib import import_module
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import cast

from export_hf import (
    HF_REPO_ID,
    PARQUET,
    QUANTILE_LEVELS,
    TASK_HORIZON,
    VISIBLE,
    read_rounds,
    write_export,
)
from forecastle_pipeline.core.baselines import seasonal_naive_7


def load_task_config(out: Path) -> dict[str, object]:
    """Read the exported task file and point it at the local parquet instead of the Hub."""
    document = import_module("yaml").safe_load((out / "tasks.yaml").read_text(encoding="utf-8"))
    tasks = cast("list[dict[str, object]]", document["tasks"])
    if len(tasks) != 1:
        msg = f"Expected one exported task, got {len(tasks)}"
        raise ValueError(msg)
    return {**tasks[0], "dataset_path": str(out / PARQUET), "dataset_config": None}


def predictions(target: list[float]) -> dict[str, list[float]]:
    """Seasonal naive 7 in fev's prediction layout; the median is the point forecast."""
    forecast = seasonal_naive_7(target, TASK_HORIZON)
    by_level = {0.1: forecast["q10"], 0.5: forecast["median"], 0.9: forecast["q90"]}
    return {"predictions": forecast["median"], **{str(q): by_level[q] for q in QUANTILE_LEVELS}}


def score(out: Path) -> dict[str, object]:
    """Load the export as a fev task and score seasonal naive 7 on its single window."""
    fev = import_module("fev")
    task = fev.Task(**load_task_config(out))
    window = task.get_window(0)
    past, _ = window.get_input_data()
    if any(len(item["target"]) != VISIBLE for item in past):
        msg = f"Every item must have {VISIBLE} values before the cutoff"
        raise ValueError(msg)
    summary: dict[str, object] = task.evaluation_summary(
        [[predictions([float(value) for value in item["target"]]) for item in past]],
        model_name="seasonal-naive-7",
    )
    return summary


def main() -> None:
    """Check the live export, or the synthetic fixture while no live round has resolved."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("benchmark", type=Path, help="Benchmark directory with rounds/")
    args = parser.parse_args()
    try:
        rounds = read_rounds(args.benchmark)
        live = [item for item in rounds if item["id"] != "fixture"]
        source = "live rounds" if live else "synthetic fixture (no live round has resolved)"
        with TemporaryDirectory(prefix="fev-check-") as temporary:
            out = Path(temporary)
            write_export(out, live or rounds, args.benchmark / "DATACARD.md", HF_REPO_ID)
            summary = score(out)
        print(f"Loaded the {source} as a fev task: {summary['num_forecasts']} items.")
        print(f"seasonal-naive-7 MASE = {summary['MASE']}, SQL = {summary['SQL']}")
    except (OSError, ValueError, AssertionError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
