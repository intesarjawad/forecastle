import importlib.util
import json
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest
from forecastle_pipeline.cli import candidate, catalogue_entries
from forecastle_pipeline.core.puzzle import ERA5_FETCH_LAG_DAYS, FIRST_END_DATE, RECENT_PUZZLES
from forecastle_pipeline.series.base import DailyPoint, SeriesError

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "calibrate_k.py"
spec = importlib.util.spec_from_file_location("calibrate_k", SCRIPT)
assert spec is not None
assert spec.loader is not None
calibration = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = calibration
spec.loader.exec_module(calibration)


def test_draws_follow_daily_eligibility_and_bounds() -> None:
    candidates = [candidate(entry) for entry in catalogue_entries().values()]
    run_day = date(2026, 11, 5)
    draws = calibration.draw_puzzles(candidates, run_day)
    assert draws == calibration.draw_puzzles(list(reversed(candidates)), run_day)
    assert len(draws) == calibration.PUZZLE_COUNT
    assert [(draw.series.id, draw.end.isoformat()) for draw in draws[:3]] == [
        ("wiki-en-Machu_Picchu", "2026-09-06"),
        ("meteo-madrid-tmean", "2026-05-19"),
        ("wiki-en-Autumn", "2026-03-14"),
    ]
    for index, draw in enumerate(draws):
        assert FIRST_END_DATE <= draw.end <= run_day - timedelta(days=ERA5_FETCH_LAG_DAYS)
        previous = draws[max(0, index - RECENT_PUZZLES) : index]
        assert draw.series.id not in {item.series.id for item in previous}
        if index:
            assert draw.series.kind != draws[index - 1].series.kind


def test_calibration_uses_flat_error_median_and_seeded_percentile_interval() -> None:
    ratios = [1.0, 2.0, 3.0, 4.0]
    k, interval = calibration.calibrated_k(ratios)
    assert k == 5
    assert interval == [2, 8]
    assert calibration.calibrated_k(ratios) == (k, interval)
    assert calibration.calibrated_k([7.0] * 300) == (14, [14, 14])


@pytest.mark.parametrize("ratios", [[], [0.0], [-1.0], [float("nan")], [float("inf")]])
def test_invalid_calibration_errors_fail(ratios: list[float]) -> None:
    with pytest.raises(ValueError, match=r"Calibration requires|Median flat-line"):
        calibration.calibrated_k(ratios)


class CountingSeries:
    calls = 0

    def fetch_daily(self, start: date, end: date) -> list[DailyPoint]:
        self.calls += 1
        return [DailyPoint(start, 1.0), DailyPoint(end, 2.0)]


def test_cached_fetch_reuses_observations_and_rejects_missing_days(tmp_path: Path) -> None:
    source = CountingSeries()
    start, end = date(2026, 1, 1), date(2026, 1, 2)
    cache = tmp_path / "series.json"
    points = calibration.cached_points(source, cache, start, end)
    assert calibration.cached_points(source, cache, start, end) == points
    assert source.calls == 1
    cache.write_text(json.dumps([{"date": start.isoformat(), "value": 1}]))
    with pytest.raises(SeriesError, match="Missing daily value"):
        calibration.cached_points(source, cache, start, end)
