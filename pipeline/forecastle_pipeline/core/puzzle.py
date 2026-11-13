from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from hashlib import sha256
from itertools import pairwise
from typing import Literal, TypedDict

from numpy.random import default_rng

from forecastle_pipeline.core.scoring import typical_move

# ADR 0004: the entire 35-day window follows the weights' publication.
FIRST_END_DATE = date(2025, 12, 5)
ERA5_FETCH_LAG_DAYS = 12
RECENT_PUZZLES = 30
DOMAIN_PADDING = 0.4
MIN_VISIBLE_POINTS = 2
SeriesKind = Literal["open_meteo", "wikimedia"]


class PuzzlePublic(TypedDict):
    """Public numeric fields; identity, metadata and forecasts are added by the shell."""

    visible: list[float]
    typical_move: float
    y_domain: tuple[float, float]
    horizon: int
    gap_days: int


class Answer(TypedDict):
    """Private window dates and scored values, kept separate until reveal."""

    dates: list[str]
    actual: list[float]


@dataclass(frozen=True)
class WindowShape:
    """Lengths of the visible history, unscored gap and scored horizon."""

    horizon: int = 7
    visible: int = 28
    gap_days: int = 0


@dataclass(frozen=True)
class SeriesCandidate:
    """Catalogue identity and source kind used by the daily draw."""

    id: str
    kind: SeriesKind


def drawing_domain(domain: tuple[float, float], kind: object) -> tuple[float, float]:
    """Stop a page-view chart at zero, since padding can reach below it and a count cannot."""
    lower, upper = domain
    return (max(0.0, lower), upper) if kind == "wikimedia" else (lower, upper)


def build_puzzle(
    series_values: Sequence[float],
    dates: Sequence[date],
    end_index: int,
    shape: WindowShape,
) -> tuple[PuzzlePublic, Answer]:
    """Split an inclusive scored end into visible, unscored gap and actual windows."""
    horizon, visible, gap_days = shape.horizon, shape.visible, shape.gap_days
    if visible < MIN_VISIBLE_POINTS or horizon < 1 or gap_days < 0:
        msg = "Require visible >= 2, horizon >= 1 and gap_days >= 0"
        raise ValueError(msg)
    start = end_index + 1 - visible - gap_days - horizon
    if len(series_values) != len(dates) or start < 0 or end_index >= len(dates):
        msg = "Aligned values and dates must contain the full requested window"
        raise ValueError(msg)
    stop = end_index + 1
    window_dates = dates[start:stop]
    if any((later - earlier).days != 1 for earlier, later in pairwise(window_dates)):
        msg = "Puzzle dates must be consecutive daily observations"
        raise ValueError(msg)
    history = list(series_values[start : start + visible])
    padding = DOMAIN_PADDING * (max(history) - min(history))
    return (
        {
            "visible": history,
            "typical_move": typical_move(history),
            "y_domain": (min(history) - padding, max(history) + padding),
            "horizon": horizon,
            "gap_days": gap_days,
        },
        {
            "dates": [day.isoformat() for day in window_dates],
            "actual": list(series_values[stop - horizon : stop]),
        },
    )


def draw_end_date(puzzle_date: str, run_date: date) -> date:
    """Draw the last scored day using the workflow's UTC date and puzzle-date seed."""
    latest = run_date - timedelta(days=ERA5_FETCH_LAG_DAYS)
    if latest < FIRST_END_DATE:
        msg = "Run date leaves no historical window beyond the 12-day data lag"
        raise ValueError(msg)
    seed = int.from_bytes(sha256(puzzle_date.encode()).digest()[:8], "big")
    offset = int(default_rng(seed).integers((latest - FIRST_END_DATE).days + 1))
    return FIRST_END_DATE + timedelta(days=offset)


def draw_daily_series(
    puzzle_date: str,
    candidates: Sequence[SeriesCandidate],
    previous_puzzles: Sequence[SeriesCandidate],
    *,
    alternate: bool = True,
) -> SeriesCandidate:
    """Choose from a catalogue, with history ordered from oldest to newest.

    `alternate=False` drops the kind rule, for the source-outage fallback only.
    """
    recent_ids = {entry.id for entry in previous_puzzles[-RECENT_PUZZLES:]}
    previous_kind = previous_puzzles[-1].kind if previous_puzzles and alternate else None
    eligible = sorted(
        (
            entry
            for entry in candidates
            if entry.id not in recent_ids and entry.kind != previous_kind
        ),
        key=lambda entry: entry.id,
    )
    if not eligible:
        msg = "No series satisfies the recent-history and alternating-kind rules"
        raise ValueError(msg)
    seed = int.from_bytes(sha256(puzzle_date.encode()).digest()[:8], "big")
    return eligible[int(default_rng(seed).integers(len(eligible)))]
