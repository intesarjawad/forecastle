"""Write the resolved live charts as a fev task and mirror it to the Hugging Face Hub."""

import argparse
import os
from datetime import date, datetime, time, timedelta
from importlib import import_module
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Protocol, TypedDict

from forecastle_pipeline.core.live_calendar import GAP_OFFSETS_DAYS
from forecastle_pipeline.io.files import read_object
from forecastle_pipeline.io.round_schema import HORIZON, VISIBLE, ResolvedRound, parse_round

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BENCHMARK = PROJECT_ROOT / "benchmark"
HF_REPO_ID = "intesarjawad/forecastle"
CONFIG = "live"
PARQUET = f"{CONFIG}/data.parquet"
GAP = len(GAP_OFFSETS_DAYS)
# Opponent-style horizon: the unscored gap days come first, then the seven scored days.
TASK_HORIZON = GAP + HORIZON
SEASONALITY = 7
QUANTILE_LEVELS = (0.1, 0.5, 0.9)
FRONT_MATTER = f"""---
license: cc-by-4.0
pretty_name: Forecastle live rounds
tags:
  - forecasting
  - fev
  - wikipedia
task_categories:
  - time-series-forecasting
configs:
  - config_name: {CONFIG}
    data_files:
      - split: train
        path: {CONFIG}/*.parquet
---

"""


class Series(TypedDict):
    """One chart as a fev item: 28 visible days, three empty gap days, seven scored days."""

    id: str
    round_id: str
    series_id: str
    timestamp: list[datetime]
    target: list[float]


class HubApi(Protocol):
    """The two Hub calls the mirror needs."""

    def create_repo(self, repo_id: str, *, token: str, repo_type: str, exist_ok: bool) -> object:
        """Create the dataset repository unless it exists."""
        ...

    def upload_folder(
        self, *, repo_id: str, folder_path: Path, repo_type: str, token: str, commit_message: str
    ) -> object:
        """Commit every file under the folder."""
        ...


def read_rounds(directory: Path) -> list[ResolvedRound]:
    """Validate every persisted round under the benchmark directory, oldest first."""
    rounds: list[ResolvedRound] = []
    for path in sorted((directory / "rounds").glob("*.json")):
        try:
            rounds.append(parse_round(read_object(path)))
        except ValueError as error:
            msg = f"Invalid resolved round {path}: {error}"
            raise ValueError(msg) from error
    return sorted(rounds, key=lambda item: (item["openDay"], item["id"]))


def chart_series(resolved: ResolvedRound, index: int) -> Series:
    """Lay one chart out on a daily grid; gap days are NaN because they are never scored."""
    chart = resolved["charts"][index]
    first_scored = date.fromisoformat(chart["scoredDates"][0])
    start = first_scored - timedelta(days=VISIBLE + GAP)
    return {
        "id": chart["id"],
        "round_id": resolved["id"],
        "series_id": chart["seriesId"],
        "timestamp": [
            datetime.combine(start + timedelta(days=offset), time())
            for offset in range(VISIBLE + TASK_HORIZON)
        ],
        "target": [*chart["visible"], *([float("nan")] * GAP), *chart["actual"]],
    }


def series_rows(rounds: list[ResolvedRound]) -> list[Series]:
    """Every chart of every round, in round order."""
    return [
        chart_series(resolved, index)
        for resolved in rounds
        for index in range(len(resolved["charts"]))
    ]


def write_parquet(path: Path, rows: list[Series]) -> None:
    """Write the fev item layout: string id, list-of-timestamp column, list-of-double target."""
    pa = import_module("pyarrow")
    pq = import_module("pyarrow.parquet")
    schema = pa.schema(
        [
            ("id", pa.string()),
            ("round_id", pa.string()),
            ("series_id", pa.string()),
            ("timestamp", pa.list_(pa.timestamp("ms"))),
            ("target", pa.list_(pa.float64())),
        ]
    )
    table = pa.Table.from_pylist(list(rows), schema=schema)
    path.parent.mkdir(parents=True, exist_ok=True)
    pq.write_table(table, path)


def render_tasks(repo_id: str) -> str:
    """Describe the fev task in the format of fev.Benchmark.from_yaml."""
    levels = ", ".join(str(level) for level in QUANTILE_LEVELS)
    return (
        "tasks:\n"
        f"  - dataset_path: {repo_id}\n"
        f"    dataset_config: {CONFIG}\n"
        f"    horizon: {TASK_HORIZON}\n"
        "    num_windows: 1\n"
        f"    initial_cutoff: -{TASK_HORIZON}\n"
        f"    min_context_length: {VISIBLE}\n"
        f"    seasonality: {SEASONALITY}\n"
        "    eval_metric: MASE\n"
        "    extra_metrics: [SQL]\n"
        f"    quantile_levels: [{levels}]\n"
    )


def write_export(out: Path, rounds: list[ResolvedRound], card: Path, repo_id: str) -> None:
    """Write the dataset repository layout: card with front matter, task file, parquet."""
    if not rounds:
        msg = "No resolved rounds to export"
        raise ValueError(msg)
    out.mkdir(parents=True, exist_ok=True)
    (out / "README.md").write_text(
        FRONT_MATTER + card.read_text(encoding="utf-8"), encoding="utf-8"
    )
    (out / "tasks.yaml").write_text(render_tasks(repo_id), encoding="utf-8")
    write_parquet(out / PARQUET, series_rows(rounds))


def push(folder: Path, repo_id: str, token: str, api: HubApi | None = None) -> None:
    """Create the dataset repository if needed and commit the export folder to it."""
    hub = api or import_module("huggingface_hub").HfApi()
    hub.create_repo(repo_id, token=token, repo_type="dataset", exist_ok=True)
    hub.upload_folder(
        repo_id=repo_id,
        folder_path=folder,
        repo_type="dataset",
        token=token,
        commit_message="Update live rounds",
    )


def main() -> None:
    """Export the live rounds and push them, or only write the folder with --no-push."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--benchmark", type=Path, default=BENCHMARK, help="Directory with rounds/")
    parser.add_argument("--repo", default=HF_REPO_ID, help="Hub dataset id, owner/name")
    parser.add_argument("--out", type=Path, help="Keep the export in this directory")
    parser.add_argument("--no-push", action="store_true", help="Write the export without pushing")
    args = parser.parse_args()
    try:
        rounds = [item for item in read_rounds(args.benchmark) if item["id"] != "fixture"]
        if not rounds:
            print("No resolved live rounds yet; nothing to export.")
            return
        token = os.environ.get("HF_TOKEN", "")
        if not args.no_push and not token:
            parser.error("HF_TOKEN is not set; use --no-push to only write the export")
        card = args.benchmark / "DATACARD.md"
        with TemporaryDirectory(prefix="hf-export-") as temporary:
            out = args.out or Path(temporary)
            write_export(out, rounds, card, args.repo)
            if args.no_push:
                print(f"Wrote {len(rounds)} rounds to {out}")
            else:
                push(out, args.repo, token)
                print(f"Pushed {len(rounds)} rounds to {args.repo}")
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
