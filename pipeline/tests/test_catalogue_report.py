import importlib.util
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest
from forecastle_pipeline.series.base import DailyPoint, SeriesError
from forecastle_pipeline.series.wikimedia import WikimediaSeries

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/catalogue_report.py"
spec = importlib.util.spec_from_file_location("catalogue_report", SCRIPT)
assert spec is not None
assert spec.loader is not None
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


def test_report_uses_the_selected_complete_ninety_day_window(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, date, date]] = []

    def fetch(self: WikimediaSeries, start: date, end: date) -> list[DailyPoint]:
        calls.append((self.article, start, end))
        return [DailyPoint(start + timedelta(days=index), float(index)) for index in range(90)]

    monkeypatch.setattr(report.WikimediaSeries, "fetch_daily", fetch)
    output = report.render_report(date(2026, 11, 3))
    assert len(calls) == 7
    assert all(start == date(2026, 8, 6) and end == date(2026, 11, 3) for _, start, end in calls)
    assert "| Meteor shower | 44.5 |" in output
    assert "| Fibonacci number | 44.5 |" in output
    assert "2026-08-06 through 2026-11-03" in output


def test_cli_names_missing_data_without_printing_a_table(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def fail(_end: date) -> str:
        msg = "Missing daily value for 2026-10-01"
        raise SeriesError(msg)

    monkeypatch.setattr(report, "render_report", fail)
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--end", "2026-11-03"])
    with pytest.raises(SystemExit) as error:
        report.main()
    assert error.value.code == 1
    captured = capsys.readouterr()
    assert not captured.out
    assert "Missing daily value" in captured.err


def test_cli_requires_a_calendar_date(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--end", "2026-02-30"])
    with pytest.raises(SystemExit) as error:
        report.main()
    assert error.value.code == 2
