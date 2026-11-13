import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts/funnel_report.py"
spec = importlib.util.spec_from_file_location("funnel_report", SCRIPT)
assert spec is not None
assert spec.loader is not None
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)

EXPORT = {
    "submissions": [
        {"puzzle_id": "2026-11-10", "ms_to_lock": 1500, "d1": 4.0},
        {"puzzle_id": "2026-11-09", "ms_to_lock": 1200, "d1": 1.0},
        {"puzzle_id": "2026-11-09", "ms_to_lock": 800, "d1": 2.0},
        {"puzzle_id": "2026-11-10", "ms_to_lock": 500, "d1": 5.0},
        {"puzzle_id": "2026-11-09", "ms_to_lock": 4000, "d1": 3.0},
    ]
}


def write_export(tmp_path: Path, payload: object) -> Path:
    path = tmp_path / "export.json"
    path.write_text(json.dumps(payload))
    return path


def test_report_prints_hand_checked_counts_and_median_lock_times(tmp_path: Path) -> None:
    output = report.render_report(write_export(tmp_path, EXPORT))
    lines = [" ".join(line.split()) for line in output.splitlines()]
    assert lines[0] == "| Puzzle | Submissions | Median msToLock |"
    assert lines[2:] == [
        "| 2026-11-09 | 3 | 1200 |",
        "| 2026-11-10 | 2 | 1000 |",
        "",
        (
            "Return rate is not reported: puzzle ids are per puzzle, so the export cannot link "
            "submissions from the same player across puzzles."
        ),
    ]


def test_empty_export_still_prints_the_header_and_note(tmp_path: Path) -> None:
    output = report.render_report(write_export(tmp_path, {"submissions": []}))
    assert "| Puzzle | Submissions | Median msToLock |" in output
    assert "Return rate is not reported" in output


@pytest.mark.parametrize("ms_to_lock", [-1, 1.5, "1200", None, True])
def test_rows_without_a_lock_time_are_rejected(tmp_path: Path, ms_to_lock: object) -> None:
    payload = {"submissions": [{"puzzle_id": "2026-11-09", "ms_to_lock": ms_to_lock}]}
    with pytest.raises(ValueError, match="nonnegative integer ms_to_lock"):
        report.render_report(write_export(tmp_path, payload))


def test_missing_submissions_fail_without_a_table(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="Expected a JSON array"):
        report.render_report(write_export(tmp_path, {}))


def test_cli_prints_the_report(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    export = write_export(tmp_path, EXPORT)
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), str(export)])
    report.main()
    output = " ".join(capsys.readouterr().out.split())
    assert "| 2026-11-09 | 3 | 1200 |" in output
    assert "| 2026-11-10 | 2 | 1000 |" in output
    assert "Return rate is not reported" in output
