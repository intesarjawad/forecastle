import json
from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime, timedelta
from hashlib import sha256
from math import isfinite
from pathlib import Path

import huggingface_hub
import pytest
from forecastle_pipeline import cli
from forecastle_pipeline.forecasters.base import Forecast
from forecastle_pipeline.forecasters.chronos2 import Chronos2Forecaster, ModelLock
from forecastle_pipeline.io.files import read_index
from forecastle_pipeline.series.base import DailyPoint, SeriesError, json_array, json_object
from forecastle_pipeline.series.open_meteo import OpenMeteoSeries
from forecastle_pipeline.series.wikimedia import WikimediaSeries

RUN_TIME = datetime(2026, 11, 5, 23, 59, tzinfo=UTC)


def load_object(path: Path) -> Mapping[str, object]:
    return json_object(json.loads(path.read_text(encoding="utf-8")))


def finite_path(value: object, length: int) -> list[float]:
    values = json_array(value)
    assert len(values) == length
    assert all(
        isinstance(item, (int, float)) and not isinstance(item, bool) and isfinite(item)
        for item in values
    )
    return [float(item) for item in values if isinstance(item, (int, float))]


def validate_puzzle(puzzle: Mapping[str, object]) -> None:
    common = {
        "id",
        "number",
        "kind",
        "seriesId",
        "label",
        "unit",
        "visible",
        "typicalMove",
        "yDomain",
        "horizon",
        "gapDays",
        "forecastSha256",
    }
    assert puzzle["kind"] in ("historical", "prospective")
    for field in ("id", "seriesId", "label", "unit"):
        assert isinstance(puzzle[field], str)
        assert puzzle[field]
    assert type(puzzle["number"]) is int
    assert puzzle["number"] > 0
    finite_path(puzzle["visible"], 28)
    domain = finite_path(puzzle["yDomain"], 2)
    assert domain[0] <= domain[1]
    move = puzzle["typicalMove"]
    assert isinstance(move, (int, float))
    assert isfinite(move)
    assert move > 0
    assert puzzle["horizon"] == 7
    digest = puzzle["forecastSha256"]
    assert isinstance(digest, str)
    assert len(digest) == 64
    assert all(character in "0123456789abcdef" for character in digest)
    if puzzle["kind"] == "prospective":
        assert "ai" not in puzzle
        assert puzzle.keys() == common | {"opensUtc", "cutoffUtc", "resolvesUtc", "scoredDates"}
        assert puzzle["gapDays"] == 3
        cutoff = datetime.fromisoformat(str(puzzle["cutoffUtc"]))
        scored = json_array(puzzle["scoredDates"])
        assert len(scored) == 7
        assert all(date.fromisoformat(str(day)) > cutoff.date() for day in scored)
    else:
        assert puzzle.keys() == common | {"ai"}
        assert puzzle["gapDays"] == 0
        ai = json_object(puzzle["ai"])
        assert ai.keys() == {"forecaster", "revision", "median", "q10", "q90"}
        assert ai["forecaster"] == "amazon/chronos-2"
        assert isinstance(ai["revision"], str)
        assert len(ai["revision"]) == 40
        paths = [finite_path(ai[key], 7) for key in ("q10", "median", "q90")]
        assert all(low <= mid <= high for low, mid, high in zip(*paths, strict=True))
        canonical = json.dumps(ai, sort_keys=True, separators=(",", ":")).encode()
        assert sha256(canonical).hexdigest() == digest


def validate_files(out: Path, game_path: Path) -> None:
    index = load_object(out / "index.json")
    assert index.keys() == {"launchDate", "puzzles", "live"}
    entries = [json_object(entry) for entry in json_array(index["puzzles"])]
    ids = [str(entry["id"]) for entry in entries]
    assert ids == sorted(set(ids))
    launch = min(ids)
    assert load_object(game_path)["launchDate"] == index["launchDate"] == launch
    assert isinstance(index["live"], list)
    for entry in entries:
        assert entry.keys() == {"id", "number", "kind", "label"}
        puzzle_id = str(entry["id"])
        puzzle = load_object(out / puzzle_id / "puzzle.json")
        validate_puzzle(puzzle)
        assert all(puzzle[key] == value for key, value in entry.items())
        assert (
            puzzle["number"]
            == (date.fromisoformat(puzzle_id) - date.fromisoformat(launch)).days + 1
        )
        answer = load_object(out / puzzle_id / "answer.json")
        assert answer.keys() == {"id", "dates", "actual", "source"}
        assert answer["id"] == puzzle_id
        finite_path(answer["actual"], 7)
        dates = [date.fromisoformat(str(day)) for day in json_array(answer["dates"])]
        assert len(dates) == 35
        assert dates == [dates[0] + timedelta(days=offset) for offset in range(35)]
        assert dates[-1] <= RUN_TIME.date() - timedelta(days=12)
        assert dates[0] >= date(2025, 11, 1)
        source = json_object(answer["source"])
        assert source.keys() == {"name", "url", "license"}
        assert all(isinstance(value, str) and value for value in source.values())


@pytest.fixture
def offline_sources(monkeypatch: pytest.MonkeyPatch) -> list[tuple[date, date]]:
    fetched: list[tuple[date, date]] = []

    def fetch(_self: object, start: date, end: date) -> list[DailyPoint]:
        fetched.append((start, end))
        return [
            DailyPoint(start + timedelta(days=i), float(i)) for i in range((end - start).days + 1)
        ]

    def forecast(_self: object, visible: Sequence[float], horizon: int) -> Forecast:
        assert len(visible) == 28
        return {"median": [visible[-1]] * horizon, "q10": [20.0] * horizon, "q90": [40.0] * horizon}

    monkeypatch.setattr(OpenMeteoSeries, "fetch_daily", fetch)
    monkeypatch.setattr(WikimediaSeries, "fetch_daily", fetch)

    def initialize(_self: object) -> None:
        return

    monkeypatch.setattr(
        cli, "CATALOGUE_PATH", Path(__file__).resolve().parents[2] / "data/catalogue.json"
    )
    monkeypatch.setattr(Chronos2Forecaster, "__post_init__", initialize)
    monkeypatch.setattr(Chronos2Forecaster, "forecast", forecast)
    return fetched


def game_config(path: Path, launch: str) -> Path:
    game = path / "data" / "game.json"
    game.parent.mkdir()
    game.write_text(json.dumps({"launchDate": launch, "workerUrl": "", "submitRateSchedule": []}))
    return game


def test_make_puzzle_schema_and_noop(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, offline_sources: list[tuple[date, date]]
) -> None:
    monkeypatch.chdir(tmp_path)
    game = tmp_path / "data" / "game.json"
    out = tmp_path / "puzzles"
    args = ["make-puzzle", "--date", "2026-11-20", "--out", str(out)]
    cli.main(args, clock=lambda: RUN_TIME)
    validate_files(out, game)
    paths = [game, *out.rglob("*.json")]
    before = {path: (path.read_bytes(), path.stat().st_mtime_ns) for path in paths}
    cli.main(args, clock=lambda: RUN_TIME + timedelta(days=1))
    assert len(offline_sources) == 1
    assert before == {path: (path.read_bytes(), path.stat().st_mtime_ns) for path in before}


def test_today_uses_injected_utc_clock(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, offline_sources: list[tuple[date, date]]
) -> None:
    monkeypatch.chdir(tmp_path)
    game = game_config(tmp_path, "2026-11-06")
    out = tmp_path / "puzzles"
    # This instant is still November 5 in its own offset, but November 6 UTC.
    clock = datetime.fromisoformat("2026-11-05T23:59:00-06:00")
    cli.main(["make-puzzle", "--date", "today", "--out", str(out)], clock=lambda: clock)
    assert (out / "2026-11-06" / "puzzle.json").is_file()
    assert len(offline_sources) == 1
    assert load_object(game)["launchDate"] == "2026-11-06"


def test_index_keeps_history_and_alternates_kinds(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, offline_sources: list[tuple[date, date]]
) -> None:
    monkeypatch.chdir(tmp_path)
    game = game_config(tmp_path, "2026-11-20")
    out = tmp_path / "puzzles"
    for puzzle_date in ("2026-11-20", "2026-11-22"):
        cli.main(["make-puzzle", "--date", puzzle_date, "--out", str(out)], clock=lambda: RUN_TIME)
    validate_files(out, game)
    first = load_object(out / "2026-11-20" / "puzzle.json")
    second = load_object(out / "2026-11-22" / "puzzle.json")
    assert str(first["seriesId"]).startswith("wiki-") is not str(second["seriesId"]).startswith(
        "wiki-"
    )
    assert len(offline_sources) == 2


def test_schema_rejects_prospective_ai() -> None:
    puzzle: dict[str, object] = {
        "id": "live-2026-11-09-1",
        "number": 1,
        "kind": "prospective",
        "seriesId": "wiki-en-Aurora",
        "label": "Aurora",
        "unit": "views",
        "visible": [1.0] * 28,
        "typicalMove": 1.0,
        "yDomain": [0.0, 2.0],
        "horizon": 7,
        "gapDays": 3,
        "forecastSha256": "0" * 64,
        "opensUtc": "2026-11-09T00:05:00Z",
        "cutoffUtc": "2026-11-10T23:59:59Z",
        "resolvesUtc": "2026-11-18T06:00:00Z",
        "scoredDates": [(date(2026, 11, 11) + timedelta(days=i)).isoformat() for i in range(7)],
    }
    validate_puzzle(puzzle)
    puzzle["ai"] = {}
    with pytest.raises(AssertionError):
        validate_puzzle(puzzle)


def test_fetch_failure_leaves_no_published_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, offline_sources: list[tuple[date, date]]
) -> None:
    def unavailable(_self: object, start: date, end: date) -> list[DailyPoint]:
        msg = f"Unavailable {start} through {end}"
        raise SeriesError(msg)

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(OpenMeteoSeries, "fetch_daily", unavailable)
    monkeypatch.setattr(WikimediaSeries, "fetch_daily", unavailable)
    out = tmp_path / "puzzles"
    with pytest.raises(SystemExit) as error:
        cli.main(["make-puzzle", "--date", "2026-11-20", "--out", str(out)], clock=lambda: RUN_TIME)
    assert error.value.code == 2
    assert not out.exists()
    assert not offline_sources


def test_open_meteo_outage_retries_once_then_draws_a_wikimedia_series(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, offline_sources: list[tuple[date, date]]
) -> None:
    monkeypatch.chdir(tmp_path)
    game = game_config(tmp_path, "2026-11-20")
    out = tmp_path / "puzzles"
    cli.main(["make-puzzle", "--date", "2026-11-20", "--out", str(out)], clock=lambda: RUN_TIME)
    first = load_object(out / "2026-11-20" / "puzzle.json")
    assert str(first["seriesId"]).startswith("wiki-")
    outages: list[tuple[date, date]] = []

    def unreachable(_self: object, start: date, end: date) -> list[DailyPoint]:
        outages.append((start, end))
        msg = "https://archive-api.open-meteo.com/v1/archive returned 503"
        raise SeriesError(msg)

    monkeypatch.setattr(OpenMeteoSeries, "fetch_daily", unreachable)
    # The kinds alternate, so the second day draws a city first.
    cli.main(["make-puzzle", "--date", "2026-11-21", "--out", str(out)], clock=lambda: RUN_TIME)
    second = load_object(out / "2026-11-21" / "puzzle.json")
    assert len(outages) == 2
    assert outages[0] == outages[1]
    assert str(second["seriesId"]).startswith("wiki-")
    assert second["seriesId"] != first["seriesId"]
    assert len(offline_sources) == 2
    validate_files(out, game)


def test_a_failing_wikimedia_series_names_the_probe_command(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    offline_sources: list[tuple[date, date]],
) -> None:
    def missing(_self: object, start: date, _end: date) -> list[DailyPoint]:
        msg = f"Missing daily value for {start}"
        raise SeriesError(msg)

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(OpenMeteoSeries, "fetch_daily", missing)
    monkeypatch.setattr(WikimediaSeries, "fetch_daily", missing)
    with pytest.raises(SystemExit) as error:
        cli.main(
            ["make-puzzle", "--date", "2026-11-20", "--out", str(tmp_path / "p")],
            clock=lambda: RUN_TIME,
        )
    assert error.value.code == 2
    what, next_step = capsys.readouterr().err.splitlines()
    series = what.removeprefix("error: ").split(":")[0]
    assert series.startswith("wiki-")
    assert "Missing daily value" in what
    assert next_step == (
        f"next: Run `uv run forecastle-pipeline probe {series}` to see what the source returns."
    )
    assert not offline_sources


def test_corrupt_index_is_not_replaced(tmp_path: Path) -> None:
    (tmp_path / "index.json").write_text('{"puzzles": []}')
    with pytest.raises(ValueError, match="index"):
        read_index(tmp_path)


def test_game_config_updates_launch_and_preserves_settings(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, offline_sources: list[tuple[date, date]]
) -> None:
    monkeypatch.chdir(tmp_path)
    game = game_config(tmp_path, "2026-11-19")
    original = load_object(game)
    out = tmp_path / "puzzles"
    args = ["make-puzzle", "--date", "2026-11-20", "--out", str(out)]
    cli.main(args, clock=lambda: RUN_TIME)
    validate_files(out, game)
    assert load_object(game) == {**original, "launchDate": "2026-11-20"}
    game.unlink()
    cli.main(args, clock=lambda: RUN_TIME)
    validate_files(out, game)
    assert load_object(game)["liveChartsPerRound"] == 3
    assert len(offline_sources) == 1
    game.write_text(json.dumps({**original, "launchDate": "2026-11-21"}))
    cli.main(args, clock=lambda: RUN_TIME)
    validate_files(out, game)
    assert load_object(game) == {**original, "launchDate": "2026-11-20"}
    assert len(offline_sources) == 1


def test_partial_date_is_never_overwritten(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, offline_sources: list[tuple[date, date]]
) -> None:
    monkeypatch.chdir(tmp_path)
    out = tmp_path / "puzzles"
    partial = out / "2026-11-20"
    partial.mkdir(parents=True)
    original = partial / "puzzle.json"
    original.write_text("partial")
    with pytest.raises(SystemExit) as error:
        cli.main(["make-puzzle", "--date", "2026-11-20", "--out", str(out)], clock=lambda: RUN_TIME)
    assert error.value.code == 2
    assert original.read_text() == "partial"
    assert not offline_sources


@pytest.mark.parametrize("redownload", [False, True])
def test_fetch_model_checks_pins_and_hashes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, *, redownload: bool
) -> None:
    (tmp_path / "config.json").write_bytes(b"{}")
    digest = sha256(b"{}").hexdigest()
    locks: dict[str, ModelLock] = {
        repo: {"revision": revision, "license": "apache-2.0", "files": {"config.json": digest}}
        for repo, revision in (
            ("amazon/chronos-2", "revision-a"),
            ("autogluon/chronos-2-small", "revision-b"),
        )
    }
    calls: list[tuple[str, str, bool]] = []

    def download(
        repo: str, *, revision: str, force_download: bool, allow_patterns: list[str]
    ) -> str:
        assert allow_patterns == ["config.json"]
        calls.append((repo, revision, force_download))
        return str(tmp_path)

    monkeypatch.setattr(cli, "model_locks", lambda: locks)
    monkeypatch.setattr(huggingface_hub, "snapshot_download", download)
    cli.fetch_models(redownload=redownload)
    assert calls == [(repo, lock["revision"], redownload) for repo, lock in locks.items()]
    (tmp_path / "config.json").write_bytes(b"tampered")
    with pytest.raises(ValueError, match="checksum mismatch"):
        cli.fetch_models(redownload=redownload)
