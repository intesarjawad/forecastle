import json
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from email.message import Message
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit

import pytest
from forecastle_pipeline import __version__
from forecastle_pipeline.cli import main
from forecastle_pipeline.series.base import DailyPoint, Series, SeriesError
from forecastle_pipeline.series.http import TIMEOUT_SECONDS, get_json
from forecastle_pipeline.series.open_meteo import OpenMeteoSeries
from forecastle_pipeline.series.wikimedia import WikimediaSeries

FIXTURES = Path(__file__).parent / "fixtures"
START = date(2026, 10, 1)
END = date(2026, 10, 14)


def fixture(name: str) -> object:
    with (FIXTURES / f"{name}.json").open() as source:
        payload: object = json.load(source)
        return payload


@pytest.fixture(autouse=True)
def block_network() -> Iterator[None]:
    with patch(
        "forecastle_pipeline.series.http.urlopen", side_effect=AssertionError("Network used")
    ):
        yield


def test_open_meteo_recorded_values_and_query() -> None:
    series: Series = OpenMeteoSeries(59.91, 10.75)
    with patch(
        "forecastle_pipeline.series.open_meteo.get_json",
        return_value=fixture("open_meteo_oslo"),
    ) as request:
        points = series.fetch_daily(START, END)
    assert [point.date for point in points] == [START + timedelta(days=i) for i in range(14)]
    assert [point.value for point in points] == [
        15.1,
        14.0,
        12.8,
        11.0,
        15.1,
        12.3,
        8.5,
        7.4,
        7.4,
        4.9,
        5.0,
        5.3,
        6.5,
        9.1,
    ]
    url: str = request.call_args.args[0]
    assert urlsplit(url).netloc == "archive-api.open-meteo.com"
    assert parse_qs(urlsplit(url).query) == {
        "latitude": ["59.91"],
        "longitude": ["10.75"],
        "start_date": ["2026-10-01"],
        "end_date": ["2026-10-14"],
        "daily": ["temperature_2m_mean"],
        "timezone": ["auto"],
        "models": ["era5"],
    }


def test_open_meteo_recorded_trailing_null_names_first_missing_day() -> None:
    with (
        patch(
            "forecastle_pipeline.series.open_meteo.get_json",
            return_value=fixture("open_meteo_oslo_trailing_null"),
        ),
        pytest.raises(SeriesError, match="2026-10-31"),
    ):
        OpenMeteoSeries(59.91, 10.75).fetch_daily(date(2026, 10, 25), date(2026, 11, 4))


def test_wikimedia_recorded_values_and_dates() -> None:
    series: Series = WikimediaSeries("en.wikipedia", "Pumpkin")
    with patch(
        "forecastle_pipeline.series.wikimedia.get_json",
        return_value=fixture("wikimedia_pumpkin"),
    ) as request:
        points = series.fetch_daily(START, END)
    assert [point.date for point in points] == [START + timedelta(days=i) for i in range(14)]
    assert [point.value for point in points] == [
        1630,
        1455,
        1380,
        1539,
        1629,
        1708,
        1641,
        1634,
        1566,
        1604,
        1761,
        1918,
        1751,
        1761,
    ]
    request.assert_called_once_with(
        "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/"
        "en.wikipedia/all-access/user/Pumpkin/daily/2026100100/2026101400",
    )


def test_wikimedia_encodes_article_as_single_segment() -> None:
    with patch(
        "forecastle_pipeline.series.wikimedia.get_json",
        return_value=fixture("wikimedia_pumpkin"),
    ) as request:
        WikimediaSeries("en.wikipedia", "Café / 100%?").fetch_daily(START, END)
    assert "/Caf%C3%A9_%2F_100%25%3F/daily/" in request.call_args.args[0]


@pytest.mark.parametrize("kind", ["meteo", "wiki"])
@pytest.mark.parametrize("offset", [0, 1, 2])
def test_absent_days_name_first_missing_date(kind: str, offset: int) -> None:
    days = [START + timedelta(days=i) for i in range(3) if i != offset]
    series: Series
    if kind == "meteo":
        payload = {
            "daily": {
                "time": [day.isoformat() for day in days],
                "temperature_2m_mean": [0] * len(days),
            }
        }
        module = "open_meteo"
        series = OpenMeteoSeries(59.91, 10.75)
    else:
        payload = {"items": [{"timestamp": f"{day:%Y%m%d}00", "views": 0} for day in days]}
        module = "wikimedia"
        series = WikimediaSeries("en.wikipedia", "Pumpkin")
    with (
        patch(f"forecastle_pipeline.series.{module}.get_json", return_value=payload),
        pytest.raises(SeriesError, match=(START + timedelta(days=offset)).isoformat()),
    ):
        series.fetch_daily(START, START + timedelta(days=2))


@pytest.mark.parametrize("series", [OpenMeteoSeries(0, 0), WikimediaSeries("en.wikipedia", "X")])
def test_reversed_range_rejected_without_network(series: Series) -> None:
    with pytest.raises(SeriesError, match="after end date"):
        series.fetch_daily(END, START)


@pytest.mark.parametrize("value", [True, "1", float("inf"), float("nan"), 1e308, -1e308, 10**400])
def test_invalid_numeric_observations_rejected(value: object) -> None:
    with (
        patch(
            "forecastle_pipeline.series.wikimedia.get_json",
            return_value={
                "items": [{"timestamp": "2026100100", "views": value}],
            },
        ),
        pytest.raises(SeriesError, match="2026-10-01"),
    ):
        WikimediaSeries("en.wikipedia", "Pumpkin").fetch_daily(START, START)


@pytest.mark.parametrize("status", [204, 301, 404, 429, 500])
def test_http_error_includes_url_and_status(status: int) -> None:
    url = "https://example.invalid/series"
    with (
        patch(
            "forecastle_pipeline.series.http.urlopen",
            side_effect=HTTPError(
                url,
                status,
                "failure",
                Message(),
                None,
            ),
        ),
        pytest.raises(SeriesError, match=f"{url} returned {status}"),
    ):
        get_json(url)


def test_http_success_sets_identity_and_timeout() -> None:
    with patch("forecastle_pipeline.series.http.urlopen") as request:
        response = request.return_value.__enter__.return_value
        response.status = 200
        response.read.return_value = b'{"value": 1}'
        assert get_json("https://example.invalid/series") == {"value": 1}
    sent = request.call_args.args[0]
    assert sent.get_header("User-agent").startswith(f"forecastle-pipeline/{__version__} (+")
    assert request.call_args.kwargs["timeout"] == TIMEOUT_SECONDS == 30


def test_http_non_200_response_rejected() -> None:
    with patch("forecastle_pipeline.series.http.urlopen") as request:
        request.return_value.__enter__.return_value.status = 204
        with pytest.raises(SeriesError, match=r"https://example\.invalid/series returned 204"):
            get_json("https://example.invalid/series")


@pytest.mark.parametrize("error", [URLError("offline"), TimeoutError("timed out")])
def test_transport_failure_includes_url(error: Exception) -> None:
    with (
        patch("forecastle_pipeline.series.http.urlopen", side_effect=error),
        pytest.raises(SeriesError, match=r"https://example\.invalid/series could not be fetched"),
    ):
        get_json("https://example.invalid/series")


def test_invalid_json_includes_url() -> None:
    with patch("forecastle_pipeline.series.http.urlopen") as request:
        response = request.return_value.__enter__.return_value
        response.status = 200
        response.read.return_value = b"not JSON"
        with pytest.raises(
            SeriesError, match=r"https://example\.invalid/series returned invalid JSON"
        ):
            get_json("https://example.invalid/series")


def test_probe_prints_fourteen_values(capsys: pytest.CaptureFixture[str]) -> None:
    points = [DailyPoint(START + timedelta(days=i), float(i)) for i in range(14)]
    with (
        patch("sys.argv", ["forecastle-pipeline", "probe", "meteo-oslo-tmean"]),
        patch("forecastle_pipeline.cli.datetime") as clock,
        patch("forecastle_pipeline.cli.OpenMeteoSeries.fetch_daily", return_value=points) as fetch,
    ):
        clock.now.return_value = datetime(2026, 11, 5, tzinfo=UTC)
        main()
    lines = capsys.readouterr().out.splitlines()
    assert len(lines) == 14
    assert lines[0] == "2026-10-01 0.0"
    assert lines[-1] == "2026-10-14 13.0"
    fetch.assert_called_once_with(date(2026, 10, 11), date(2026, 10, 24))


@pytest.mark.parametrize("payload", [None, [], {"daily": []}, {"daily": {"time": []}}])
def test_malformed_meteo_payload_rejected(payload: object) -> None:
    with (
        patch("forecastle_pipeline.series.open_meteo.get_json", return_value=payload),
        pytest.raises(SeriesError, match="Expected a JSON"),
    ):
        OpenMeteoSeries(59.91, 10.75).fetch_daily(START, START)


def test_misaligned_meteo_arrays_rejected() -> None:
    with (
        patch(
            "forecastle_pipeline.series.open_meteo.get_json",
            return_value={
                "daily": {"time": ["2026-10-01"], "temperature_2m_mean": []},
            },
        ),
        pytest.raises(SeriesError, match="different lengths"),
    ):
        OpenMeteoSeries(59.91, 10.75).fetch_daily(START, START)


@pytest.mark.parametrize("timestamp", [None, "not-a-date", "2026130100"])
def test_invalid_wikimedia_timestamp_rejected(timestamp: object) -> None:
    with (
        patch(
            "forecastle_pipeline.series.wikimedia.get_json",
            return_value={
                "items": [{"timestamp": timestamp, "views": 1}],
            },
        ),
        pytest.raises(SeriesError, match="timestamp"),
    ):
        WikimediaSeries("en.wikipedia", "Pumpkin").fetch_daily(START, START)


@pytest.mark.parametrize("kind", ["meteo", "wiki"])
def test_duplicate_days_rejected(kind: str) -> None:
    series: Series
    if kind == "meteo":
        payload = {"daily": {"time": ["2026-10-01", "2026-10-01"], "temperature_2m_mean": [1, 2]}}
        module = "open_meteo"
        series = OpenMeteoSeries(59.91, 10.75)
    else:
        payload = {"items": [{"timestamp": "2026100100", "views": i} for i in range(2)]}
        module = "wikimedia"
        series = WikimediaSeries("en.wikipedia", "Pumpkin")
    with (
        patch(f"forecastle_pipeline.series.{module}.get_json", return_value=payload),
        pytest.raises(SeriesError, match="Duplicate daily value for 2026-10-01"),
    ):
        series.fetch_daily(START, START)


def test_wikimedia_orders_days_and_preserves_zero() -> None:
    with patch(
        "forecastle_pipeline.series.wikimedia.get_json",
        return_value={
            "items": [
                {"timestamp": "2026100200", "views": 4},
                {"timestamp": "2026100100", "views": 0},
            ],
        },
    ):
        points = WikimediaSeries("en.wikipedia", "Pumpkin").fetch_daily(
            START,
            START + timedelta(days=1),
        )
    assert points == [DailyPoint(START, 0), DailyPoint(START + timedelta(days=1), 4)]


def test_probe_accepts_any_catalogue_series(capsys: pytest.CaptureFixture[str]) -> None:
    points = [DailyPoint(START + timedelta(days=i), float(i)) for i in range(14)]
    with (
        patch("sys.argv", ["forecastle-pipeline", "probe", "wiki-en-Pumpkin"]),
        patch("forecastle_pipeline.cli.WikimediaSeries.fetch_daily", return_value=points) as fetch,
    ):
        main()
    assert len(capsys.readouterr().out.splitlines()) == 14
    fetch.assert_called_once()


def test_probe_rejects_an_unknown_series(capsys: pytest.CaptureFixture[str]) -> None:
    with (
        patch("sys.argv", ["forecastle-pipeline", "probe", "meteo-atlantis-tmean"]),
        pytest.raises(SystemExit) as error,
    ):
        main()
    assert error.value.code == 2
    assert "Unknown series id meteo-atlantis-tmean" in capsys.readouterr().err


def test_probe_source_failure_exits_nonzero(capsys: pytest.CaptureFixture[str]) -> None:
    with (
        patch("sys.argv", ["forecastle-pipeline", "probe", "meteo-oslo-tmean"]),
        patch(
            "forecastle_pipeline.cli.OpenMeteoSeries.fetch_daily",
            side_effect=SeriesError(
                "Missing daily value for 2026-10-01",
            ),
        ),
        pytest.raises(SystemExit) as error,
    ):
        main()
    assert error.value.code == 2
    assert capsys.readouterr().err == "error: Missing daily value for 2026-10-01\n"
