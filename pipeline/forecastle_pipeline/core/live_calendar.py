from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from hashlib import sha256

from numpy.random import default_rng

OPEN_WEEKDAYS = (0, 3)
VISIBLE_END_OFFSET_DAYS = -2
GAP_OFFSETS_DAYS = (-1, 0, 1)
SCORED_START_OFFSET_DAYS = 2
SCORED_END_OFFSET_DAYS = 8
RESOLVE_OFFSET_DAYS = 9
CHARTS_PER_ROUND = 3


@dataclass(frozen=True)
class LiveDates:
    """Calendar dates and timezone-aware UTC instants for a live round."""

    visible_end: date
    gap_dates: tuple[date, ...]
    scored_dates: tuple[date, ...]
    opens_utc: datetime
    cutoff_utc: datetime
    resolves_utc: datetime


def live_round_dates(open_day: date) -> LiveDates:
    """Open Monday or Thursday, close before any scored day and resolve after all seven."""
    if open_day.weekday() not in OPEN_WEEKDAYS:
        msg = "Live rounds must open on Monday or Thursday"
        raise ValueError(msg)
    return LiveDates(
        visible_end=open_day + timedelta(days=VISIBLE_END_OFFSET_DAYS),
        gap_dates=tuple(open_day + timedelta(days=offset) for offset in GAP_OFFSETS_DAYS),
        scored_dates=tuple(
            open_day + timedelta(days=offset)
            for offset in range(SCORED_START_OFFSET_DAYS, SCORED_END_OFFSET_DAYS + 1)
        ),
        opens_utc=datetime.combine(open_day, time(0, 5), UTC),
        cutoff_utc=datetime.combine(open_day + timedelta(days=1), time(23, 59, 59), UTC),
        resolves_utc=datetime.combine(open_day + timedelta(days=RESOLVE_OFFSET_DAYS), time(6), UTC),
    )


def draw_live_articles(
    open_day: date,
    eligible_articles: Sequence[str],
    previous_rounds: Mapping[date, Sequence[str]],
) -> tuple[str, ...]:
    """Draw three distinct eligible article ids, excluding overlapping scored windows."""
    scored = set(live_round_dates(open_day).scored_dates)
    excluded = {
        article
        for previous_day, articles in previous_rounds.items()
        if scored.intersection(live_round_dates(previous_day).scored_dates)
        for article in articles
    }
    candidates = sorted(set(eligible_articles) - excluded)
    if len(candidates) < CHARTS_PER_ROUND:
        msg = "Fewer than three eligible articles remain after excluding overlapping rounds"
        raise ValueError(msg)
    seed = int.from_bytes(sha256(open_day.isoformat().encode()).digest()[:8], "big")
    indices = default_rng(seed).choice(len(candidates), size=CHARTS_PER_ROUND, replace=False)
    return tuple(candidates[int(index)] for index in indices)
