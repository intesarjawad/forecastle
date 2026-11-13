import shutil
from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime, timedelta
from hashlib import sha256
from pathlib import Path

import pytest
from forecastle_pipeline import cli
from forecastle_pipeline.core.live_calendar import draw_live_articles
from forecastle_pipeline.forecasters.base import Forecast
from forecastle_pipeline.forecasters.chronos2 import Chronos2Forecaster
from forecastle_pipeline.io import live, live_open
from forecastle_pipeline.io.files import canonical_json, read_object
from forecastle_pipeline.io.resolve import chart_forecasts, resolve_chart, write_round
from forecastle_pipeline.io.round_schema import ResolvedChart, parse_round
from forecastle_pipeline.series.base import DailyPoint, SeriesError, json_array, json_object
from forecastle_pipeline.series.wikimedia import WikimediaSeries

ROOT = Path(__file__).resolve().parents[2]
OPEN = datetime(2026, 11, 9, 0, 5, tzinfo=UTC)
CLOSE = datetime(2026, 11, 11, 0, 5, tzinfo=UTC)
RESOLVE = datetime(2026, 11, 18, 6, tzinfo=UTC)
ROUND_ID = "live-2026-11-09"
RUN_REPORT = live.run_report


def complete_proof(_proof: Path) -> str:
    return "complete"


def observations(_self: object, start: date, end: date) -> list[DailyPoint]:
    return [
        DailyPoint(day, float(1000 + day.toordinal() % 300))
        for offset in range((end - start).days + 1)
        if (day := start + timedelta(days=offset))
    ]


@pytest.fixture
def offline_round(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Mapping[str, Mapping[str, object]]:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SEAL_KEY", "0123456789abcdef" * 4)
    monkeypatch.setenv("EXPORT_TOKEN", "fixed-test-token")
    (tmp_path / "data").mkdir()
    (tmp_path / "data/game.json").write_text(
        '{"launchDate":"2026-11-09","workerUrl":"https://example.invalid"}'
    )
    (tmp_path / "scoring").mkdir()
    shutil.copyfile(ROOT / "scoring/constants.json", tmp_path / "scoring/constants.json")
    monkeypatch.setattr(cli, "CATALOGUE_PATH", ROOT / "data/catalogue.json")
    monkeypatch.setattr(WikimediaSeries, "fetch_daily", observations)

    def initialize(_self: object) -> None:
        return

    monkeypatch.setattr(Chronos2Forecaster, "__post_init__", initialize)

    def forecast(_self: object, visible: Sequence[float], horizon: int) -> Forecast:
        assert (len(visible), horizon) in ((28, 10), (365, 10), (28, 8))
        return {
            "median": [visible[-1]] * horizon,
            "q10": [visible[-1] - 10] * horizon,
            "q90": [visible[-1] + 10] * horizon,
        }

    def stamp(path: Path) -> None:
        Path(f"{path}.ots").write_bytes(b"offline lifecycle proof")

    monkeypatch.setattr(Chronos2Forecaster, "forecast", forecast)
    monkeypatch.setattr(live, "stamp", stamp)
    monkeypatch.setattr(live_open, "stamp", stamp)
    monkeypatch.setattr(live, "upgrade", complete_proof)
    monkeypatch.setattr(live, "run_report", lambda: None)

    def export_empty(_id: str, _path: Path) -> list[object]:
        return []

    monkeypatch.setattr(live, "export_submissions", export_empty)
    return cli.catalogue_entries()


def test_open_is_sealed_and_close_reveals_idempotently(
    offline_round: Mapping[str, Mapping[str, object]],
) -> None:
    cli.main(["open-live-round", "--open-day", "2026-11-09"], clock=lambda: OPEN)
    directory = live.PUBLIC / ROUND_ID
    assert len(list(directory.glob("*/forecast.json.ots"))) == 3
    assert len(list(live.SEALED.glob(f"{ROUND_ID}/*/forecast.json.enc"))) == 3
    assert not list(directory.rglob("forecast.json"))
    assert not list(directory.rglob("answer.json"))
    for path in directory.glob("*/puzzle.json"):
        assert "ai" not in read_object(path)
    with pytest.raises(ValueError, match="before cutoffUtc"):
        live.close_round(ROUND_ID, OPEN, offline_round)
    before = {path: path.read_bytes() for path in directory.rglob("*") if path.is_file()}
    live_open.open_round(OPEN.date(), OPEN, offline_round)
    assert before == {path: path.read_bytes() for path in before}
    cli.main(["close-live-round", "--id", ROUND_ID], clock=lambda: CLOSE)
    for path in directory.glob("*/puzzle.json"):
        puzzle = read_object(path)
        assert (
            sha256((path.parent / "forecast.json").read_bytes()).hexdigest()
            == puzzle["forecastSha256"]
        )
        assert (
            sha256((path.parent / "forecast-cutoff.json").read_bytes()).hexdigest()
            == puzzle["cutoffForecastSha256"]
        )
    before = {path: path.read_bytes() for path in directory.rglob("*") if path.is_file()}
    live.close_round(ROUND_ID, CLOSE, offline_round)
    assert before == {path: path.read_bytes() for path in before}
    assert not list(directory.rglob("answer.json"))


def test_open_skips_articles_below_the_view_floor_or_without_data(
    offline_round: Mapping[str, Mapping[str, object]], monkeypatch: pytest.MonkeyPatch
) -> None:
    eligible = sorted(
        key
        for key, entry in offline_round.items()
        if entry.get("prospectiveEligible") is True and entry.get("kind") == "wikimedia"
    )
    first_draw = draw_live_articles(OPEN.date(), eligible, {})
    quiet, missing = first_draw[0], first_draw[1]

    def views(self: WikimediaSeries, start: date, end: date) -> list[DailyPoint]:
        if self.article == offline_round[missing]["article"]:
            msg = f"Missing daily value for {start}"
            raise SeriesError(msg)
        # A median of 499 views, one short of the floor.
        level = 499.0 if self.article == offline_round[quiet]["article"] else 2000.0
        return [
            DailyPoint(start + timedelta(days=offset), level)
            for offset in range((end - start).days + 1)
        ]

    monkeypatch.setattr(WikimediaSeries, "fetch_daily", views)
    cli.main(["open-live-round", "--open-day", "2026-11-09"], clock=lambda: OPEN)
    drawn = {
        str(read_object(path)["seriesId"])
        for path in (live.PUBLIC / ROUND_ID).glob("*/puzzle.json")
    }
    assert len(drawn) == 3
    assert quiet not in drawn
    assert missing not in drawn


def test_tampered_commitment_never_publishes_plaintext(
    offline_round: Mapping[str, Mapping[str, object]],
) -> None:
    live_open.open_round(OPEN.date(), OPEN, offline_round)
    path = live.PUBLIC / ROUND_ID / "1/puzzle.json"
    puzzle = dict(read_object(path))
    puzzle["forecastSha256"] = "0" * 64
    path.write_bytes(canonical_json(puzzle))
    with pytest.raises(ValueError, match="SHA-256 mismatch"):
        live.close_round(ROUND_ID, CLOSE, offline_round)
    assert not list(live.PUBLIC.rglob("forecast.json"))


def test_resolution_retries_missing_values_and_failed_export(
    offline_round: Mapping[str, Mapping[str, object]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    live_open.open_round(OPEN.date(), OPEN, offline_round)
    live.close_round(ROUND_ID, CLOSE, offline_round)

    def unavailable(_self: object, _start: date, _end: date) -> list[DailyPoint]:
        msg = "Missing daily value"
        raise SeriesError(msg)

    monkeypatch.setattr(WikimediaSeries, "fetch_daily", unavailable)
    with pytest.raises(SeriesError, match="Missing daily"):
        live.resolve_round(ROUND_ID, RESOLVE, offline_round)
    assert not list(live.PUBLIC.rglob("answer.json"))
    assert not live.ROUNDS.exists()
    monkeypatch.setattr(WikimediaSeries, "fetch_daily", observations)

    def export_failed(_id: str, _game: Path) -> list[object]:
        msg = "export unavailable after three tries"
        raise SeriesError(msg)

    monkeypatch.setattr(live, "export_submissions", export_failed)
    with pytest.raises(SystemExit) as error:
        cli.main(["resolve-live-round", ROUND_ID], clock=lambda: RESOLVE)
    assert error.value.code == 2
    assert not list(live.PUBLIC.rglob("answer.json"))
    assert not live.ROUNDS.exists()


def test_resolution_proof_retries_preserve_evidence(
    offline_round: Mapping[str, Mapping[str, object]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    live_open.open_round(OPEN.date(), OPEN, offline_round)
    live.close_round(ROUND_ID, CLOSE, offline_round)

    def pending_proof(_proof: Path) -> str:
        return "pending"

    monkeypatch.setattr(live, "upgrade", pending_proof)
    assert live.resolve_round(ROUND_ID, RESOLVE, offline_round) is False
    path = live.ROUNDS / f"{ROUND_ID}.json"
    evidence = path.read_bytes()
    with pytest.raises(ValueError, match="final resolve retry"):
        live.resolve_round(ROUND_ID, RESOLVE.replace(hour=18), offline_round)
    assert path.read_bytes() == evidence
    monkeypatch.setattr(live, "upgrade", complete_proof)
    assert live.resolve_round(ROUND_ID, RESOLVE.replace(hour=18), offline_round) is True
    assert path.read_bytes() == evidence
    assert live.due_rounds(RESOLVE + timedelta(days=30), resolve=True) == []


def test_round_resolves_twice_with_identical_bytes(
    offline_round: Mapping[str, Mapping[str, object]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def submissions(chart_id: str, _game: Path) -> list[object]:
        count = (10, 9, 0)[int(chart_id[-1]) - 1]
        return [
            {
                **{f"d{day}": float(1100 + index) for day in range(1, 8)},
                "half_width": 5,
                "client_id": "private-client",
            }
            for index in range(count)
        ]

    monkeypatch.setattr(live, "export_submissions", submissions)
    live_open.open_round(OPEN.date(), OPEN, offline_round)
    live.close_round(ROUND_ID, CLOSE, offline_round)
    assert live.resolve_round(ROUND_ID, RESOLVE, offline_round)
    path = live.ROUNDS / f"{ROUND_ID}.json"
    before = path.read_bytes()
    assert b"private-client" not in before
    assert b"client_id" not in before
    assert live.resolve_round(ROUND_ID, RESOLVE, offline_round)
    assert before == path.read_bytes()
    for index in range(1, 4):
        answer = read_object(live.PUBLIC / ROUND_ID / str(index) / "answer.json")
        assert ("crowd" in answer) == (index == 1)


def test_fixture_rebuild_is_byte_identical_twice(tmp_path: Path) -> None:
    charts: list[ResolvedChart] = []
    for index in range(1, 4):
        directory = ROOT / "benchmark/fixtures/live/fixture" / str(index)
        count = (10, 9, 0)[index - 1]
        submissions: list[object] = [
            {**{f"d{day}": float(item + day) for day in range(1, 8)}, "half_width": 5.0}
            for item in range(count)
        ]
        charts.append(
            resolve_chart(
                read_object(directory / "puzzle.json"),
                chart_forecasts(directory),
                [float(item + 28) for item in range(7)],
                submissions,
                2.0,
            )
        )
    raw: dict[str, object] = {
        "schemaVersion": 1,
        "id": "fixture",
        "openDay": "2026-11-09",
        "cutoffUtc": "2026-11-10T23:59:59+00:00",
        "charts": charts,
    }
    path = tmp_path / "fixture.json"
    for _ in range(2):
        write_round(path, raw)
        assert path.read_bytes() == (ROOT / "benchmark/rounds/fixture.json").read_bytes()
    chart = parse_round(raw)["charts"][0]
    assert "crowd" in chart
    assert chart["crowd"]["median"] == [5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 11.5]
    assert chart["crowd"]["p10"] == pytest.approx([1.9, 2.9, 3.9, 4.9, 5.9, 6.9, 7.9])
    assert chart["forecasters"]["chronos-2"]["scores"]["scaledMae"] == pytest.approx(13 / 7)


def test_contract_rejects_identifiers_and_bad_rows() -> None:
    raw = dict(read_object(ROOT / "benchmark/rounds/fixture.json"))
    raw["client_id"] = "private"
    with pytest.raises(ValueError, match="Expected fields"):
        parse_round(raw)
    del raw["client_id"]
    charts = json_array(raw["charts"])
    first = dict(json_object(charts[0]))
    first["submissionCount"] = 9
    charts[0] = first
    raw["charts"] = charts
    with pytest.raises(ValueError, match="Expected fields"):
        parse_round(raw)


def test_open_rejects_future_and_unsupported_days(
    offline_round: Mapping[str, Mapping[str, object]],
) -> None:
    with pytest.raises(ValueError, match="Monday or Thursday"):
        live_open.open_round(date(2026, 11, 10), OPEN, offline_round)
    with pytest.raises(ValueError, match="between opensUtc"):
        live_open.open_round(OPEN.date(), OPEN - timedelta(days=1), offline_round)


def test_due_rounds_keep_old_unresolved_first(
    offline_round: Mapping[str, Mapping[str, object]],
) -> None:
    live_open.open_round(OPEN.date(), OPEN, offline_round)
    assert live.due_rounds(RESOLVE, resolve=True) == [ROUND_ID]
    later = OPEN + timedelta(days=7)
    live_open.open_round(later.date(), later, offline_round)
    assert live.due_rounds(RESOLVE + timedelta(days=14), resolve=True) == [
        ROUND_ID,
        "live-2026-11-16",
    ]


def test_missing_report_retains_round_for_retry(
    offline_round: Mapping[str, Mapping[str, object]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    live_open.open_round(OPEN.date(), OPEN, offline_round)
    live.close_round(ROUND_ID, CLOSE, offline_round)
    monkeypatch.setattr(live, "run_report", RUN_REPORT)
    with pytest.raises(FileNotFoundError, match=r"benchmark_report\.py is required"):
        live.resolve_round(ROUND_ID, RESOLVE, offline_round)
    assert live.due_rounds(RESOLVE + timedelta(hours=1), resolve=True) == [ROUND_ID]
    evidence = (live.ROUNDS / f"{ROUND_ID}.json").read_bytes()
    script = Path("scripts/benchmark_report.py")
    script.parent.mkdir()
    script.write_text("from pathlib import Path\nPath('report-ran').write_text('complete')\n")
    assert live.resolve_round(ROUND_ID, RESOLVE + timedelta(hours=1), offline_round)
    assert Path("report-ran").read_text() == "complete"
    assert (live.ROUNDS / f"{ROUND_ID}.json").read_bytes() == evidence
