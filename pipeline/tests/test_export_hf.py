import importlib
import shutil
import sys
from datetime import datetime
from math import isnan
from pathlib import Path

import pytest
from forecastle_pipeline.io.files import read_object
from forecastle_pipeline.io.round_schema import parse_round

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
export = importlib.import_module("export_hf")
check = importlib.import_module("check_fev_task")
CARD = ROOT / "benchmark/DATACARD.md"
FIXTURE = parse_round(read_object(ROOT / "benchmark/rounds/fixture.json"))


class FakeHub:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []

    def create_repo(self, repo_id: str, **options: object) -> None:
        self.calls.append(("create_repo", {"repo_id": repo_id, **options}))

    def upload_folder(self, **options: object) -> None:
        self.calls.append(("upload_folder", options))


def test_chart_is_laid_out_on_a_daily_grid_with_empty_gap_days() -> None:
    row = export.chart_series(FIXTURE, 0)
    assert row["id"] == "fixture-1"
    assert row["round_id"] == "fixture"
    assert row["series_id"] == "fixture-series-1"
    # Opening day 2026-11-09: history 10-11 to 11-07, gap 11-08 to 11-10, scored 11-11 to 11-17.
    assert row["timestamp"][0] == datetime(2026, 10, 11)  # noqa: DTZ001
    assert row["timestamp"][27] == datetime(2026, 11, 7)  # noqa: DTZ001
    assert row["timestamp"][28] == datetime(2026, 11, 8)  # noqa: DTZ001
    assert row["timestamp"][31] == datetime(2026, 11, 11)  # noqa: DTZ001
    assert row["timestamp"][37] == datetime(2026, 11, 17)  # noqa: DTZ001
    assert len(row["timestamp"]) == len(row["target"]) == 38
    assert row["target"][:28] == [float(day) for day in range(28)]
    assert all(isnan(value) for value in row["target"][28:31])
    assert row["target"][31:] == [28.0, 29.0, 30.0, 31.0, 32.0, 33.0, 34.0]


def test_rows_cover_every_chart_in_round_order() -> None:
    assert [row["id"] for row in export.series_rows([FIXTURE])] == [
        "fixture-1",
        "fixture-2",
        "fixture-3",
    ]


def test_tasks_file_is_the_documented_fev_task() -> None:
    yaml = pytest.importorskip("yaml")
    assert yaml.safe_load(export.render_tasks("owner/name")) == {
        "tasks": [
            {
                "dataset_path": "owner/name",
                "dataset_config": "live",
                "horizon": 10,
                "num_windows": 1,
                "initial_cutoff": -10,
                "min_context_length": 28,
                "seasonality": 7,
                "eval_metric": "MASE",
                "extra_metrics": ["SQL"],
                "quantile_levels": [0.1, 0.5, 0.9],
            }
        ]
    }


def test_export_writes_card_task_and_parquet(tmp_path: Path) -> None:
    yaml = pytest.importorskip("yaml")
    pq = pytest.importorskip("pyarrow.parquet")
    export.write_export(tmp_path, [FIXTURE], CARD, "owner/name")
    readme = (tmp_path / "README.md").read_text(encoding="utf-8")
    front, _, body = readme.removeprefix("---\n").partition("\n---\n")
    assert yaml.safe_load(front)["configs"] == [
        {"config_name": "live", "data_files": [{"split": "train", "path": "live/*.parquet"}]}
    ]
    assert body.lstrip().startswith("# Forecastle live rounds: data card")
    assert (tmp_path / "tasks.yaml").is_file()
    table = pq.read_table(tmp_path / "live/data.parquet")
    assert table.column_names == ["id", "round_id", "series_id", "timestamp", "target"]
    assert table.column("id").to_pylist() == ["fixture-1", "fixture-2", "fixture-3"]
    assert table.column("timestamp").type.value_type.unit == "ms"
    assert len(table.column("target")[0]) == 38


def test_export_without_rounds_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="No resolved rounds"):
        export.write_export(tmp_path, [], CARD, "owner/name")


def test_push_creates_the_dataset_repository_then_uploads_the_folder(tmp_path: Path) -> None:
    hub = FakeHub()
    export.push(tmp_path, "owner/name", "secret", hub)
    assert hub.calls == [
        (
            "create_repo",
            {"repo_id": "owner/name", "token": "secret", "repo_type": "dataset", "exist_ok": True},
        ),
        (
            "upload_folder",
            {
                "repo_id": "owner/name",
                "folder_path": tmp_path,
                "repo_type": "dataset",
                "token": "secret",
                "commit_message": "Update live rounds",
            },
        ),
    ]


def benchmark_copy(tmp_path: Path) -> Path:
    directory = tmp_path / "benchmark"
    (directory / "rounds").mkdir(parents=True)
    shutil.copyfile(ROOT / "benchmark/rounds/fixture.json", directory / "rounds/fixture.json")
    shutil.copyfile(CARD, directory / "DATACARD.md")
    return directory


def test_export_script_skips_the_fixture_and_never_pushes_without_live_rounds(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(sys, "argv", ["export_hf.py", "--benchmark", str(benchmark_copy(tmp_path))])
    monkeypatch.delenv("HF_TOKEN", raising=False)
    export.main()
    assert "No resolved live rounds yet" in capsys.readouterr().out


def test_invalid_round_is_not_silently_omitted(tmp_path: Path) -> None:
    (tmp_path / "rounds").mkdir()
    (tmp_path / "rounds/bad.json").write_text('{"schemaVersion": 99}')
    with pytest.raises(ValueError, match=r"Invalid resolved round.*bad\.json"):
        export.read_rounds(tmp_path)


def test_data_card_records_the_schema_and_the_known_biases() -> None:
    card = " ".join(CARD.read_text(encoding="utf-8").split())
    for column in ("id", "round_id", "series_id", "timestamp", "target"):
        assert f"| `{column}` |" in card
    for phrase in (
        "constant half-width",
        "widens with the forecast day",
        '"players", and the crowd rows are the crowd of players',
        "may enter only the charts they find easy",
        "more information than the opponent row",
        "at-cutoff row",
        "share four scored days",
        "not fully independent clusters",
    ):
        assert phrase in card


def test_fev_loads_the_export_and_scores_seasonal_naive(tmp_path: Path) -> None:
    pytest.importorskip("fev")
    export.write_export(tmp_path, [FIXTURE], CARD, "owner/name")
    summary = check.score(tmp_path)
    # Each chart's last week repeats as 21..27 then 21..23, so the scored days 24..27, 21..23
    # miss 28..34 by 4,4,4,4,11,11,11 (mean 7); the in-sample lag-7 error is 7.
    assert summary["MASE"] == pytest.approx(1.0)
    assert summary["num_forecasts"] == 3


def test_check_script_reports_the_fixture_when_no_round_is_live(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    pytest.importorskip("fev")
    monkeypatch.setattr(sys, "argv", ["check_fev_task.py", str(benchmark_copy(tmp_path))])
    check.main()
    output = capsys.readouterr().out
    assert "synthetic fixture" in output
    assert "3 items" in output
    assert "seasonal-naive-7 MASE = 1.0" in output
