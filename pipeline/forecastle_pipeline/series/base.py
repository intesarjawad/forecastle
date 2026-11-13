from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, timedelta
from math import isfinite
from typing import Protocol, TypeGuard

from forecastle_pipeline.io.scoring import MAX_ABSOLUTE_VALUE


class SeriesError(Exception):
    """A source could not provide a complete daily series."""


class SourceUnreachableError(SeriesError):
    """The source did not answer at all, so retrying later may succeed."""


@dataclass(frozen=True)
class DailyPoint:
    """One observed value on a calendar day."""

    date: date
    value: float


class Series(Protocol):
    """A source of consecutive daily observations, with inclusive bounds."""

    def fetch_daily(self, start: date, end: date) -> list[DailyPoint]:
        """Fetch every requested day or raise SeriesError."""
        ...


def validate_range(start: date, end: date) -> None:
    """Reject reversed bounds before making a request."""
    if start > end:
        msg = f"Start date {start} is after end date {end}"
        raise SeriesError(msg)


def complete_days(values: Mapping[date, float], start: date, end: date) -> list[DailyPoint]:
    """Return observations in date order, naming the first missing day."""
    points: list[DailyPoint] = []
    for offset in range((end - start).days + 1):
        day = start + timedelta(days=offset)
        if day not in values:
            msg = f"Missing daily value for {day}"
            raise SeriesError(msg)
        points.append(DailyPoint(day, values[day]))
    return points


def _is_mapping(value: object) -> TypeGuard[Mapping[object, object]]:
    return isinstance(value, dict)


def _is_array(value: object) -> TypeGuard[list[object]]:
    return isinstance(value, list)


def json_object(value: object) -> Mapping[str, object]:
    """Validate a JSON object at the source boundary."""
    if _is_mapping(value):
        result: dict[str, object] = {}
        for key, item in value.items():
            if not isinstance(key, str):
                break
            result[key] = item
        else:
            return result
    msg = "Expected a JSON object"
    raise SeriesError(msg)


def json_array(value: object) -> list[object]:
    """Validate a JSON array at the source boundary."""
    if _is_array(value):
        return value
    msg = "Expected a JSON array"
    raise SeriesError(msg)


def observed_value(value: object, day: date) -> float:
    """Accept finite numeric observations with absolute value <= 1e100, excluding booleans."""
    if (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and abs(value) <= MAX_ABSOLUTE_VALUE
        and isfinite(value)
    ):
        return float(value)
    msg = f"Invalid daily value for {day}: {value!r}"
    raise SeriesError(msg)
