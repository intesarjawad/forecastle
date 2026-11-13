from datetime import UTC, date, datetime, time, timedelta

import pytest
from forecastle_pipeline.core.live_calendar import draw_live_articles, live_round_dates
from hypothesis import given, settings
from hypothesis import strategies as st

OPEN_DAYS = st.dates(min_value=date(1900, 1, 1), max_value=date(9998, 1, 1)).filter(
    lambda day: day.weekday() in (0, 3)
)
ARTICLES = [f"article-{index}" for index in range(12)]


def test_date_seeded_live_draw_fixture() -> None:
    assert draw_live_articles(date(2026, 11, 9), ARTICLES, {}) == (
        "article-3",
        "article-4",
        "article-9",
    )


@pytest.mark.parametrize(
    ("open_day", "visible_end", "gap_dates", "scored_dates", "cutoff_and_resolves"),
    [
        (
            "2026-11-09",
            "2026-11-07",
            ["2026-11-08", "2026-11-09", "2026-11-10"],
            [
                "2026-11-11",
                "2026-11-12",
                "2026-11-13",
                "2026-11-14",
                "2026-11-15",
                "2026-11-16",
                "2026-11-17",
            ],
            ("2026-11-10T23:59:59+00:00", "2026-11-18T06:00:00+00:00"),
        ),
        (
            "2026-11-12",
            "2026-11-10",
            ["2026-11-11", "2026-11-12", "2026-11-13"],
            [
                "2026-11-14",
                "2026-11-15",
                "2026-11-16",
                "2026-11-17",
                "2026-11-18",
                "2026-11-19",
                "2026-11-20",
            ],
            ("2026-11-13T23:59:59+00:00", "2026-11-21T06:00:00+00:00"),
        ),
    ],
)
def test_exact_calendar_fixtures(
    open_day: str,
    visible_end: str,
    gap_dates: list[str],
    scored_dates: list[str],
    cutoff_and_resolves: tuple[str, str],
) -> None:
    calendar = live_round_dates(date.fromisoformat(open_day))
    assert calendar.visible_end.isoformat() == visible_end
    assert [day.isoformat() for day in calendar.gap_dates] == gap_dates
    assert [day.isoformat() for day in calendar.scored_dates] == scored_dates
    assert calendar.opens_utc.isoformat() == open_day + "T00:05:00+00:00"
    assert calendar.cutoff_utc.isoformat() == cutoff_and_resolves[0]
    assert calendar.resolves_utc.isoformat() == cutoff_and_resolves[1]


@pytest.mark.parametrize("offset", [1, 2, 4, 5, 6])
def test_other_weekdays_raise(offset: int) -> None:
    with pytest.raises(ValueError, match="Monday or Thursday"):
        live_round_dates(date(2026, 11, 9) + timedelta(days=offset))


@settings(derandomize=True)
@given(open_day=OPEN_DAYS)
def test_scored_days_follow_cutoff_and_exclude_gap(open_day: date) -> None:
    calendar = live_round_dates(open_day)
    assert len(calendar.scored_dates) == 7
    assert len(calendar.gap_dates) == 3
    assert set(calendar.scored_dates).isdisjoint(calendar.gap_dates)
    assert all(
        datetime.combine(day, time(), UTC) > calendar.cutoff_utc for day in calendar.scored_dates
    )
    assert calendar.visible_end < min(calendar.gap_dates)
    assert calendar.opens_utc < calendar.cutoff_utc < calendar.resolves_utc


@settings(derandomize=True)
@given(first=OPEN_DAYS, rounds=st.integers(2, 20))
def test_seeded_draw_never_reuses_articles_in_overlapping_rounds(first: date, rounds: int) -> None:
    history: dict[date, tuple[str, ...]] = {}
    open_day = first
    for _ in range(rounds):
        chosen = draw_live_articles(open_day, ARTICLES, history)
        assert len(set(chosen)) == 3
        assert chosen == draw_live_articles(open_day, list(reversed(ARTICLES)), history)
        scored = set(live_round_dates(open_day).scored_dates)
        for previous_day, previous_articles in history.items():
            if scored.intersection(live_round_dates(previous_day).scored_dates):
                assert set(chosen).isdisjoint(previous_articles)
        history[open_day] = chosen
        open_day += timedelta(days=3 if open_day.weekday() == 0 else 4)


def test_live_draw_allows_nonoverlapping_reuse_and_deduplicates_candidates() -> None:
    articles = ARTICLES[:3]
    first = date(2026, 11, 9)
    history = {first: tuple(articles)}
    assert set(draw_live_articles(first + timedelta(days=7), articles * 2, history)) == set(
        articles
    )
    with pytest.raises(ValueError, match="Fewer than three"):
        draw_live_articles(first + timedelta(days=3), articles, history)
    with pytest.raises(ValueError, match="Fewer than three"):
        draw_live_articles(first, ["one"] * 3, {})
