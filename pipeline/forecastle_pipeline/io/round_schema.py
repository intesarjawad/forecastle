from collections.abc import Mapping
from datetime import date, datetime
from math import isfinite
from typing import NotRequired, TypedDict

from forecastle_pipeline.core.live_calendar import CHARTS_PER_ROUND, live_round_dates
from forecastle_pipeline.core.round_scores import Scores
from forecastle_pipeline.core.scoring import MAX_CLOSENESS, typical_move
from forecastle_pipeline.forecasters.base import Forecast
from forecastle_pipeline.io.files import text_field
from forecastle_pipeline.io.scoring import MAX_ABSOLUTE_VALUE
from forecastle_pipeline.series.base import json_array, json_object

HORIZON = 7
VISIBLE = 28
MIN_CROWD = 10
MODEL_ROWS = {
    "chronos-2",
    "chronos-2-cutoff",
    "chronos-2-long",
    "chronos-2-small",
    "seasonal-naive-7",
    "flat",
}
METRICS = {"scaledMae", "closeness", "coverage", "scaledWinkler", "scaledQuantileLoss"}


class Row(TypedDict):
    """A named forecast and its scores; median-human has scores only."""

    scores: Scores
    forecast: NotRequired[Forecast]


class Crowd(TypedDict):
    """Pointwise linear quantiles over every accepted submission, never a sample."""

    count: int
    median: list[float]
    p10: list[float]
    p90: list[float]


class ResolvedChart(TypedDict):
    """Public chart evidence with anonymous, unlinked per-submission scores."""

    id: str
    seriesId: str
    visible: list[float]
    actual: list[float]
    scoredDates: list[str]
    typicalMove: float
    submissionCount: int
    forecasters: dict[str, Row]
    submissionScores: list[Scores]
    crowd: NotRequired[Crowd]


class ResolvedRound(TypedDict):
    """Version 1 contract consumed by the statistics report; fixture ids are permitted."""

    schemaVersion: int
    id: str
    openDay: str
    cutoffUtc: str
    charts: list[ResolvedChart]


def exact_keys(payload: Mapping[str, object], expected: set[str]) -> None:
    """Reject extra fields, including identifiers accidentally copied from an export."""
    if set(payload) != expected:
        msg = f"Expected fields {sorted(expected)}, got {sorted(payload)}"
        raise ValueError(msg)


def number(value: object, *, positive: bool = False) -> float:
    """Require a finite scalar within the scoring arithmetic's supported range."""
    if (
        isinstance(value, bool)
        or not isinstance(value, (float, int))
        or not isfinite(value)
        or abs(value) > MAX_ABSOLUTE_VALUE
        or (positive and value <= 0)
    ):
        msg = "Expected a finite numeric value within 1e100"
        raise ValueError(msg)
    return float(value)


def path_values(value: object, length: int = HORIZON) -> list[float]:
    """Validate alignment before any scoring or aggregation."""
    values = json_array(value)
    if len(values) != length:
        msg = f"Expected {length} path values"
        raise ValueError(msg)
    return [number(item) for item in values]


def parse_forecast(value: object) -> Forecast:
    """Read aligned quantiles and reject crossing bounds."""
    raw = json_object(value)
    paths = [path_values(raw.get(key)) for key in ("q10", "median", "q90")]
    if any(low > mid or mid > high for low, mid, high in zip(*paths, strict=True)):
        msg = "Forecast quantiles must be ordered"
        raise ValueError(msg)
    return {"q10": paths[0], "median": paths[1], "q90": paths[2]}


def parse_scores(value: object) -> Scores:
    """Validate the shared metric names and ranges for models and submissions."""
    raw = json_object(value)
    exact_keys(raw, METRICS)
    scores: Scores = {
        "scaledMae": number(raw["scaledMae"]),
        "closeness": number(raw["closeness"]),
        "coverage": number(raw["coverage"]),
        "scaledWinkler": number(raw["scaledWinkler"]),
        "scaledQuantileLoss": number(raw["scaledQuantileLoss"]),
    }
    if (
        any(number(value) < 0 for value in scores.values())
        or scores["closeness"] > MAX_CLOSENESS
        or scores["coverage"] > 1
    ):
        msg = "Scores are outside their valid ranges"
        raise ValueError(msg)
    return scores


def parse_crowd(value: object, count: int) -> Crowd:
    """Require crowd quantiles only for eligible charts with at least ten submissions."""
    raw = json_object(value)
    exact_keys(raw, {"count", "median", "p10", "p90"})
    if count < MIN_CROWD or type(raw["count"]) is not int or raw["count"] != count:
        msg = "Crowd count must match an eligible chart"
        raise ValueError(msg)
    forecast = parse_forecast({"median": raw["median"], "q10": raw["p10"], "q90": raw["p90"]})
    return {
        "count": count,
        "median": forecast["median"],
        "p10": forecast["q10"],
        "p90": forecast["q90"],
    }


def _chart(value: object, cutoff: datetime) -> ResolvedChart:
    raw = json_object(value)
    count = raw.get("submissionCount")
    if type(count) is not int or count < 0:
        msg = "submissionCount must be a nonnegative integer"
        raise ValueError(msg)
    eligible = count >= MIN_CROWD
    exact_keys(
        raw,
        {
            "id",
            "seriesId",
            "visible",
            "actual",
            "scoredDates",
            "typicalMove",
            "submissionCount",
            "forecasters",
            "submissionScores",
        }
        | ({"crowd"} if eligible else set()),
    )
    days = [date.fromisoformat(str(item)) for item in json_array(raw["scoredDates"])]
    if len(days) != HORIZON or any(
        (day - days[0]).days != index or day <= cutoff.date() for index, day in enumerate(days)
    ):
        msg = "Scored dates must be seven consecutive days after cutoff"
        raise ValueError(msg)
    rows_raw = json_object(raw["forecasters"])
    exact_keys(rows_raw, MODEL_ROWS | ({"crowd-median", "median-human"} if eligible else set()))
    rows: dict[str, Row] = {}
    for name, item in rows_raw.items():
        row = json_object(item)
        exact_keys(row, {"scores"} if name == "median-human" else {"scores", "forecast"})
        rows[name] = {"scores": parse_scores(row["scores"])}
        if name != "median-human":
            forecast_raw = json_object(row["forecast"])
            exact_keys(forecast_raw, {"median", "q10", "q90"})
            rows[name]["forecast"] = parse_forecast(forecast_raw)
    submissions = [parse_scores(item) for item in json_array(raw["submissionScores"])]
    if len(submissions) != count:
        msg = "Submission scores must match submissionCount"
        raise ValueError(msg)
    chart: ResolvedChart = {
        "id": text_field(raw, "id"),
        "seriesId": text_field(raw, "seriesId"),
        "visible": path_values(raw["visible"], VISIBLE),
        "actual": path_values(raw["actual"]),
        "scoredDates": [day.isoformat() for day in days],
        "typicalMove": number(raw["typicalMove"], positive=True),
        "submissionCount": count,
        "forecasters": rows,
        "submissionScores": submissions,
    }
    if eligible:
        chart["crowd"] = parse_crowd(raw["crowd"], count)
    if chart["typicalMove"] != typical_move(chart["visible"]):
        msg = "typicalMove must match the opening visible history"
        raise ValueError(msg)
    return chart


def parse_round(value: object) -> ResolvedRound:
    """Validate the complete public contract, rejecting unknown fields recursively."""
    raw = json_object(value)
    exact_keys(raw, {"schemaVersion", "id", "openDay", "cutoffUtc", "charts"})
    opening = date.fromisoformat(text_field(raw, "openDay"))
    cutoff = datetime.fromisoformat(text_field(raw, "cutoffUtc"))
    offset = cutoff.utcoffset()
    if (
        type(raw["schemaVersion"]) is not int
        or raw["schemaVersion"] != 1
        or opening.weekday() not in (0, 3)
        or offset is None
        or offset.total_seconds() != 0
    ):
        msg = "Expected schemaVersion 1, Monday/Thursday openDay and a UTC cutoff"
        raise ValueError(msg)
    charts = [_chart(item, cutoff) for item in json_array(raw["charts"])]
    if (
        len(charts) != CHARTS_PER_ROUND
        or len({chart["id"] for chart in charts}) != CHARTS_PER_ROUND
    ):
        msg = "Expected three distinct charts"
        raise ValueError(msg)
    calendar = live_round_dates(opening)
    round_id = text_field(raw, "id")
    if cutoff != calendar.cutoff_utc or any(
        chart["id"] != f"{round_id}-{index}"
        or chart["scoredDates"] != [day.isoformat() for day in calendar.scored_dates]
        for index, chart in enumerate(charts, 1)
    ):
        msg = "Chart identities and dates must match the round calendar"
        raise ValueError(msg)
    return {
        "schemaVersion": 1,
        "id": round_id,
        "openDay": opening.isoformat(),
        "cutoffUtc": cutoff.isoformat(),
        "charts": charts,
    }
