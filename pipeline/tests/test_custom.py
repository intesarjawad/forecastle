import base64
import json
import re
import subprocess
import sys
import webbrowser
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from forecastle_pipeline import cli
from forecastle_pipeline.core.custom import CustomSeries, build_custom_payload, encode_payload
from forecastle_pipeline.io.custom_csv import read_series_csv
from forecastle_pipeline.messages import MessageError
from forecastle_pipeline.series.base import DailyPoint, SeriesError, SourceUnreachableError
from forecastle_pipeline.series.wikimedia import WikimediaSeries

FIXTURES = Path(__file__).parent / "fixtures"
NOW = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
START = date(2026, 1, 1)
DATELESS = CustomSeries("views", "", [float(value) for value in range(1, 36)], None)
SAMPLE_VALUES = [
    1708.0,
    1641.0,
    1634.0,
    1566.0,
    1604.0,
    1761.0,
    1918.0,
    1751.0,
    1761.0,
    1720.0,
    1682.0,
    1594.0,
    1643.0,
    1725.0,
    1802.0,
    1749.0,
    1691.0,
    1622.0,
    1705.0,
    1837.0,
    1904.0,
    1810.0,
    1773.0,
    1690.0,
    1651.0,
    1588.0,
    1636.0,
    1712.0,
    1785.0,
    1726.0,
    1679.0,
    1608.0,
    1684.0,
    1791.0,
    1867.0,
]


def csv_rows(values: list[float], *, gap_at: int | None = None) -> str:
    lines = ["date,views"]
    for index, value in enumerate(values):
        day = START + timedelta(days=index + (1 if gap_at is not None and index >= gap_at else 0))
        lines.append(f"{day.isoformat()},{value}")
    return "\n".join(lines) + "\n"


def failure(capsys: pytest.CaptureFixture[str], argv: list[str]) -> str:
    with pytest.raises(SystemExit) as error:
        cli.main(argv, clock=lambda: NOW)
    assert error.value.code == 2
    lines = capsys.readouterr().err.splitlines()
    assert len(lines) == 2
    assert lines[0].startswith("error: ")
    assert lines[1].startswith("next: ")
    assert re.search(r"`[^`]+`", lines[1])
    return lines[0]


def write(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "series.csv"
    path.write_text(text, encoding="utf-8")
    return path


class FakeModel:
    repo_id = "amazon/chronos-2"
    revision = "29ec3766d36d6f73f0696f85560a422f50e8498c"

    def forecast(self, visible: list[float], horizon: int) -> dict[str, list[float]]:
        assert len(visible) == 28
        assert horizon == 7
        return {
            "q10": [1700.0] * 7,
            "median": [1750.0] * 7,
            "q90": [1800.0] * 7,
        }


def test_reads_the_last_thirty_five_rows_and_labels_from_the_value_header(
    tmp_path: Path,
) -> None:
    path = write(tmp_path, csv_rows([float(value) for value in range(1, 41)]))
    series = read_series_csv(path)
    assert series.label == "views"
    assert series.unit == ""
    assert series.values == [float(value) for value in range(6, 41)]
    assert series.dates is not None
    assert series.dates[0] == START + timedelta(days=5)
    assert series.dates[-1] == START + timedelta(days=39)


def test_reads_the_recorded_sample_without_dates_in_the_payload() -> None:
    series = read_series_csv(FIXTURES / "custom_sample.csv")
    assert series.label == "views"
    assert series.values == SAMPLE_VALUES
    assert series.dates is not None
    assert series.dates[-1] == date(2026, 10, 10)


def test_a_single_column_needs_no_dates(tmp_path: Path) -> None:
    path = write(tmp_path, "temperature\n" + "\n".join(str(value) for value in range(35)) + "\n")
    series = read_series_csv(path)
    assert series.label == "temperature"
    assert series.values == [float(value) for value in range(35)]
    assert series.dates is None


def test_label_and_unit_overrides_are_validated(tmp_path: Path) -> None:
    path = write(tmp_path, csv_rows([1.0] * 35))
    assert read_series_csv(path, label="Mine", unit="views").label == "Mine"
    with pytest.raises(MessageError, match="16"):
        read_series_csv(path, unit="x" * 17)
    long_header = "date," + "x" * 81
    path = write(tmp_path, csv_rows([1.0] * 35).replace("date,views", long_header))
    with pytest.raises(MessageError, match="81"):
        read_series_csv(path)


@pytest.mark.parametrize("count", [1, 34])
def test_a_short_file_names_the_missing_row(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], count: int
) -> None:
    path = write(tmp_path, csv_rows([1.0] * count))
    message = failure(capsys, ["custom", str(path), "--no-open"])
    assert f"Row {count + 2}" in message


@pytest.mark.parametrize("bad", ["", "n/a", "inf", "nan"])
def test_bad_cells_name_their_row(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], bad: str
) -> None:
    path = write(
        tmp_path,
        csv_rows([1.0] * 35).replace("2026-01-08,1.0", f"2026-01-08,{bad}"),
    )
    message = failure(capsys, ["custom", str(path), "--no-open"])
    assert "Row 9" in message


def test_a_date_gap_names_its_row(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    path = write(tmp_path, csv_rows([1.0] * 35, gap_at=17))
    message = failure(capsys, ["custom", str(path), "--no-open"])
    assert "Row 19" in message


def test_a_missing_header_is_rejected(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    path = write(tmp_path, "\n".join(csv_rows([1.0] * 35).splitlines()[1:]) + "\n")
    message = failure(capsys, ["custom", str(path), "--no-open"])
    assert "Row 1" in message


def test_an_eighty_one_character_label_is_rejected(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = write(tmp_path, csv_rows([1.0] * 35))
    message = failure(capsys, ["custom", str(path), "--label", "x" * 81, "--no-open"])
    assert "81" in message


def test_a_file_and_wikipedia_are_mutually_exclusive(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = write(tmp_path, csv_rows([1.0] * 35))
    message = failure(capsys, ["custom", str(path), "--wikipedia", "Pumpkin", "--no-open"])
    assert "--wikipedia" in message


def test_a_recorded_wikipedia_404_exits_with_a_command(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    def not_found(_self: object, start: date, end: date) -> list[DailyPoint]:
        assert (start, end) == (date(2026, 9, 30), date(2026, 11, 3))
        msg = (
            "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/"
            "en.wikipedia/all-access/user/Pumpkin/daily/2026090200/2026100600 returned 404"
        )
        raise SeriesError(msg)

    monkeypatch.setattr(WikimediaSeries, "fetch_daily", not_found)
    message = failure(capsys, ["custom", "--wikipedia", "Pumpkin", "--no-open"])
    assert "404" in message


def test_a_title_with_spaces_is_quoted_in_the_next_command(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    def not_found(_self: object, _start: date, _end: date) -> list[DailyPoint]:
        msg = "https://wikimedia.org/api/rest_v1/metrics/pageviews returned 404"
        raise SeriesError(msg)

    monkeypatch.setattr(WikimediaSeries, "fetch_daily", not_found)
    with pytest.raises(SystemExit):
        cli.main(["custom", "--wikipedia", "Winter solstice", "--no-open"], clock=lambda: NOW)
    what, next_step = capsys.readouterr().err.splitlines()
    assert what.startswith("error: en.wikipedia has no complete daily views for Winter solstice")
    command = "uvx --torch-backend cpu forecastle-pipeline custom --wikipedia 'Winter solstice'"
    assert f"`{command} --no-open`" in next_step


def test_an_unreachable_source_asks_for_the_connection_not_the_title(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    def offline(_self: object, _start: date, _end: date) -> list[DailyPoint]:
        msg = "https://wikimedia.org/api/rest_v1/metrics/pageviews could not be fetched"
        raise SourceUnreachableError(msg)

    monkeypatch.setattr(WikimediaSeries, "fetch_daily", offline)
    message = failure(capsys, ["custom", "--wikipedia", "Pumpkin", "--no-open"])
    assert "could not be reached" in message


def test_build_custom_payload_has_no_dates_and_keeps_the_forecast() -> None:
    forecast = {
        "forecaster": "amazon/chronos-2",
        "revision": "29ec3766d36d6f73f0696f85560a422f50e8498c",
        "median": [1750.0] * 7,
        "q10": [1700.0] * 7,
        "q90": [1800.0] * 7,
    }
    payload, actual = build_custom_payload(DATELESS, forecast, source="Your CSV")
    assert set(payload) == {
        "kind",
        "label",
        "unit",
        "source",
        "visible",
        "typicalMove",
        "yDomain",
        "horizon",
        "gapDays",
        "ai",
        "forecastSha256",
    }
    assert payload["kind"] == "custom"
    assert payload["visible"] == DATELESS.values[:28]
    assert payload["horizon"] == 7
    assert payload["gapDays"] == 0
    assert payload["ai"] == forecast
    assert actual == DATELESS.values[-7:]
    assert "2026-" not in json.dumps(payload)


def test_dates_do_not_change_the_payload() -> None:
    forecast = {"median": [1.0] * 7, "q10": [0.0] * 7, "q90": [2.0] * 7}
    dated = CustomSeries(
        "views",
        "",
        DATELESS.values,
        [START + timedelta(days=index) for index in range(35)],
    )
    with_dates, _ = build_custom_payload(dated, forecast, source="Your CSV")
    without_dates, _ = build_custom_payload(DATELESS, forecast, source="Your CSV")
    assert with_dates == without_dates


def test_encoded_fixture_matches_its_recorded_text() -> None:
    payload = json.loads(
        (FIXTURES.parents[2] / "site/tests/fixtures/custom-payload.json").read_text()
    )
    encoded = (FIXTURES.parents[2] / "site/tests/fixtures/custom-payload.txt").read_bytes()
    assert encode_payload(payload).encode() == encoded


def test_an_oversized_payload_is_rejected() -> None:
    with pytest.raises(MessageError, match="4096"):
        encode_payload({"label": "x" * 5000})


def test_custom_writes_three_files_and_prints_the_link(
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    path = write(tmp_path, csv_rows([float(value) for value in range(1, 41)]))
    out = tmp_path / "out"
    opened: list[str] = []
    monkeypatch.setattr(cli, "load_custom_forecaster", FakeModel)
    monkeypatch.setattr(webbrowser, "open", opened.append)
    cli.main(
        ["custom", str(path), "--out", str(out)],
        clock=lambda: NOW,
    )
    lines = capsys.readouterr().out.splitlines()
    assert lines[0].startswith("Wrote puzzle")
    assert lines[1].startswith(cli.SITE_URL)
    assert lines[1][len(cli.SITE_URL) :].startswith("#/c/")
    assert opened == [lines[1]]
    encoded = lines[1].rsplit("/", 1)[1]
    link = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
    assert link == {
        "v": 1,
        "label": "views",
        "unit": "",
        "source": "",
        "visible": [float(value) for value in range(6, 34)],
        "actual": [float(value) for value in range(34, 41)],
        "ai": {"median": [1750.0] * 7, "q10": [1700.0] * 7, "q90": [1800.0] * 7},
        "model": "amazon/chronos-2",
        "revision": "29ec3766d36d6f73f0696f85560a422f50e8498c",
    }
    assert (out / "puzzle.json").is_file()
    assert (out / "answer.json").is_file()
    assert (out / "forecast.csv").read_text(encoding="utf-8") == (
        "day,q10,median,q90\n"
        "1,1700.0,1750.0,1800.0\n"
        "2,1700.0,1750.0,1800.0\n"
        "3,1700.0,1750.0,1800.0\n"
        "4,1700.0,1750.0,1800.0\n"
        "5,1700.0,1750.0,1800.0\n"
        "6,1700.0,1750.0,1800.0\n"
        "7,1700.0,1750.0,1800.0\n"
    )
    puzzle = json.loads((out / "puzzle.json").read_text(encoding="utf-8"))
    assert puzzle["visible"] == [float(value) for value in range(6, 34)]
    answer = json.loads((out / "answer.json").read_text(encoding="utf-8"))
    assert answer["actual"] == [float(value) for value in range(34, 41)]
    assert answer["source"] == ""


def test_custom_no_open_skips_the_browser(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = write(tmp_path, csv_rows([1.0] * 40))

    def opened(_url: str) -> None:
        pytest.fail("opened")

    monkeypatch.setattr(cli, "load_custom_forecaster", FakeModel)
    monkeypatch.setattr(webbrowser, "open", opened)
    cli.main(["custom", str(path), "--out", str(tmp_path / "out"), "--no-open"], clock=lambda: NOW)


def test_wikipedia_labels_and_sources_the_series(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fetch(_self: object, start: date, end: date) -> list[DailyPoint]:
        assert (end - start).days == 34
        assert end == NOW.date() - timedelta(days=2)
        return [DailyPoint(start + timedelta(days=index), 100.0 + index) for index in range(35)]

    monkeypatch.setattr(WikimediaSeries, "fetch_daily", fetch)
    monkeypatch.setattr(cli, "load_custom_forecaster", FakeModel)
    cli.main(
        ["custom", "--wikipedia", "Pumpkin", "--out", str(tmp_path / "out"), "--no-open"],
        clock=lambda: NOW,
    )
    payload = json.loads((tmp_path / "out" / "puzzle.json").read_text(encoding="utf-8"))
    assert payload["label"] == "Daily views of the Wikipedia article Pumpkin"
    assert payload["unit"] == "views"
    assert payload["source"] == "Wikipedia pageviews (CC0)"


@pytest.mark.parametrize("contents", ["", " \n, \n"])
def test_empty_csv_reports_missing_header(
    tmp_path: Path, capsys: pytest.CaptureFixture[str], contents: str
) -> None:
    path = write(tmp_path, contents)
    assert "no header row" in failure(capsys, ["custom", str(path), "--no-open"])


def test_custom_help_avoids_model_imports() -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from forecastle_pipeline.cli import main; main(['custom', '--help'])",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    assert "--wikipedia" in result.stdout
    assert "Wikipedia article" in result.stdout
    assert "--no-open" in result.stdout
    assert "browser" in result.stdout
    assert "torch" not in result.stderr.lower()
