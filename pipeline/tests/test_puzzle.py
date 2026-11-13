from datetime import date, timedelta

import pytest
from forecastle_pipeline.core.puzzle import (
    FIRST_END_DATE,
    SeriesCandidate,
    WindowShape,
    build_puzzle,
    draw_daily_series,
    draw_end_date,
    drawing_domain,
)
from hypothesis import given, settings
from hypothesis import strategies as st

START = date(2025, 11, 1)
DATES = [START + timedelta(days=offset) for offset in range(100)]
VALUES = [float(index) for index in range(100)]
CANDIDATES = [
    SeriesCandidate(f"{kind}-{index}", kind)
    for kind in ("open_meteo", "wikimedia")
    for index in range(20)
]


def test_daily_window_ends_on_last_scored_day() -> None:
    public, answer = build_puzzle(VALUES, DATES, 34, WindowShape())
    assert public == {
        "visible": VALUES[:28],
        "typical_move": 1.0,
        "y_domain": (-10.8, 37.8),
        "horizon": 7,
        "gap_days": 0,
    }
    assert answer == {"dates": [day.isoformat() for day in DATES[:35]], "actual": VALUES[28:35]}
    assert set(public) == {"visible", "typical_move", "y_domain", "horizon", "gap_days"}


def test_live_window_skips_three_days() -> None:
    public, answer = build_puzzle(VALUES, DATES, 50, WindowShape(gap_days=3))
    assert public["visible"] == VALUES[13:41]
    assert answer["actual"] == VALUES[44:51]
    assert answer["dates"] == [day.isoformat() for day in DATES[13:51]]
    assert public["gap_days"] == 3


@pytest.mark.parametrize("level", [-100.0, 0.0, 100.0])
def test_flat_window_uses_exact_visible_range_padding(level: float) -> None:
    public, _ = build_puzzle([level] * 35, DATES[:35], 34, WindowShape())
    assert public["y_domain"] == (level, level)
    assert public["typical_move"] > 0


@pytest.mark.parametrize(
    ("end_index", "horizon", "visible", "gap_days"),
    [
        (33, 7, 28, 0),
        (100, 7, 28, 0),
        (-1, 7, 28, 0),
        (34, 0, 28, 0),
        (34, 7, 1, 0),
        (34, 7, 28, -1),
    ],
)
def test_rejects_invalid_windows(end_index: int, horizon: int, visible: int, gap_days: int) -> None:
    with pytest.raises(ValueError, match=r"Require|Aligned"):
        build_puzzle(VALUES, DATES, end_index, WindowShape(horizon, visible, gap_days))


def test_rejects_misaligned_and_missing_dates() -> None:
    with pytest.raises(ValueError, match="Aligned"):
        build_puzzle(VALUES[:-1], DATES, 34, WindowShape())
    missing = [*DATES[:20], *DATES[21:]]
    with pytest.raises(ValueError, match="consecutive"):
        build_puzzle(VALUES[:99], missing, 34, WindowShape())


@settings(derandomize=True)
@given(
    visible=st.integers(2, 40),
    horizon=st.integers(1, 15),
    gap=st.integers(0, 10),
    extra=st.integers(0, 20),
)
def test_visible_never_contains_an_actual_index(
    visible: int, horizon: int, gap: int, extra: int
) -> None:
    end = extra + visible + gap + horizon - 1
    public, answer = build_puzzle(VALUES, DATES, end, WindowShape(horizon, visible, gap))
    assert public["visible"] == VALUES[extra : extra + visible]
    assert answer["actual"] == VALUES[end - horizon + 1 : end + 1]
    assert set(public["visible"]).isdisjoint(answer["actual"])
    assert len(answer["dates"]) == visible + gap + horizon


@settings(derandomize=True)
@given(
    puzzle_date=st.dates(),
    run_date=st.dates(min_value=date(2025, 12, 17), max_value=date(9998, 12, 31)),
)
def test_seeded_end_date_respects_release_and_workflow_lag(
    puzzle_date: date, run_date: date
) -> None:
    end = draw_end_date(puzzle_date.isoformat(), run_date)
    assert FIRST_END_DATE <= end <= run_date - timedelta(days=12)
    assert end - timedelta(days=34) >= START
    assert end == draw_end_date(puzzle_date.isoformat(), run_date)


def test_end_draw_inclusive_single_day_range_and_invalid_range() -> None:
    assert draw_end_date("2030-01-01", date(2025, 12, 17)) == FIRST_END_DATE
    with pytest.raises(ValueError, match="12-day"):
        draw_end_date("2030-01-01", date(2025, 12, 16))
    ends = {draw_end_date(str(seed), date(2025, 12, 18)) for seed in range(100)}
    assert ends == {FIRST_END_DATE, FIRST_END_DATE + timedelta(days=1)}


def test_date_seeded_draw_fixtures() -> None:
    assert draw_end_date("2026-11-09", date(2026, 11, 5)) == date(2026, 7, 16)
    assert draw_daily_series("2026-11-09", CANDIDATES, []) == SeriesCandidate(
        "wikimedia-15", "wikimedia"
    )


@settings(derandomize=True)
@given(start=st.integers(0, 10000))
def test_daily_draw_skips_thirty_puzzles_and_alternates_kinds(start: int) -> None:
    history: list[SeriesCandidate] = []
    for offset in range(80):
        seed = (START + timedelta(days=start + offset)).isoformat()
        selected = draw_daily_series(seed, CANDIDATES, history)
        assert selected not in history[-30:]
        assert not history or selected.kind != history[-1].kind
        assert selected == draw_daily_series(seed, list(reversed(CANDIDATES)), history)
        history.append(selected)


def test_daily_draw_allows_series_used_thirty_one_puzzles_ago() -> None:
    target = SeriesCandidate("target", "wikimedia")
    history = [target] + [SeriesCandidate(str(index), "open_meteo") for index in range(30)]
    assert draw_daily_series("2026-11-09", [target], history) == target
    with pytest.raises(ValueError, match="No series"):
        draw_daily_series("2026-11-09", [target], history[:30])
    with pytest.raises(ValueError, match="No series"):
        draw_daily_series("2026-11-09", [], [])


def test_page_view_chart_stops_at_zero() -> None:
    assert drawing_domain((-7300.0, 27800.0), "wikimedia") == (0.0, 27800.0)
    assert drawing_domain((120.0, 900.0), "wikimedia") == (120.0, 900.0)


def test_temperature_chart_keeps_room_below_zero() -> None:
    assert drawing_domain((-3.4, 16.4), "open_meteo") == (-3.4, 16.4)
