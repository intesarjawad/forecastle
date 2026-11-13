from collections.abc import Mapping
from pathlib import Path

import numpy as np

from forecastle_pipeline.core.round_scores import median_scores, score_forecast
from forecastle_pipeline.forecasters.base import Forecast
from forecastle_pipeline.io.files import canonical_json, read_object, text_field
from forecastle_pipeline.io.round_schema import (
    MIN_CROWD,
    Crowd,
    ResolvedChart,
    Row,
    number,
    parse_forecast,
    parse_round,
    path_values,
)
from forecastle_pipeline.series.base import json_array, json_object


def submission_forecast(value: object) -> Forecast:
    """Decode a D1 export row, discarding all identifiers and timing metadata."""
    raw = json_object(value)
    path = path_values([raw.get(f"d{index}") for index in range(1, 8)])
    width = number(raw.get("half_width"))
    if width < 0:
        msg = "Submission half_width must be nonnegative"
        raise ValueError(msg)
    return parse_forecast(
        {
            "median": path,
            "q10": [item - width for item in path],
            "q90": [item + width for item in path],
        }
    )


def resolve_chart(
    puzzle: Mapping[str, object],
    forecasts: Mapping[str, Forecast],
    actual: list[float],
    submissions: list[object],
    k: float,
) -> ResolvedChart:
    """Build anonymous chart evidence and crowd paths from the full accepted export."""
    visible = path_values(puzzle.get("visible"), 28)
    actual = path_values(actual)
    entries = [submission_forecast(item) for item in submissions]
    scores = [score_forecast(visible, item, actual, k) for item in entries]
    # Stable metric ordering makes repeated exports byte-identical even if D1 row order changes.
    scores.sort(key=lambda item: tuple(number(value) for value in item.values()))
    rows: dict[str, Row] = {
        name: {"forecast": forecast, "scores": score_forecast(visible, forecast, actual, k)}
        for name, forecast in forecasts.items()
    }
    chart: ResolvedChart = {
        "id": text_field(puzzle, "id"),
        "seriesId": text_field(puzzle, "seriesId"),
        "visible": visible,
        "actual": actual,
        "scoredDates": [str(day) for day in json_array(puzzle["scoredDates"])],
        "typicalMove": number(puzzle["typicalMove"], positive=True),
        "submissionCount": len(entries),
        "forecasters": rows,
        "submissionScores": scores,
    }
    if len(entries) >= MIN_CROWD:
        quantiles = np.quantile(
            np.asarray(sorted(item["median"] for item in entries)), [0.1, 0.5, 0.9], axis=0
        )
        crowd: Crowd = {
            "count": len(entries),
            "median": [float(item) for item in quantiles[1]],
            "p10": [float(item) for item in quantiles[0]],
            "p90": [float(item) for item in quantiles[2]],
        }
        chart["crowd"] = crowd
        crowd_forecast: Forecast = {
            "median": crowd["median"],
            "q10": crowd["p10"],
            "q90": crowd["p90"],
        }
        rows["crowd-median"] = {
            "forecast": crowd_forecast,
            "scores": score_forecast(visible, crowd_forecast, actual, k),
        }
        rows["median-human"] = {"scores": median_scores(scores)}
    return chart


def write_round(path: Path, value: Mapping[str, object]) -> None:
    """Validate before atomically replacing public round evidence."""
    encoded = canonical_json(parse_round(value))
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    temporary.write_bytes(encoded)
    temporary.replace(path)


def chart_forecasts(directory: Path) -> dict[str, Forecast]:
    """Read all comparisons committed inside the opening forecast and the cutoff row."""
    opening = read_object(directory / "forecast.json")
    comparisons = json_object(opening.get("comparisons"))
    return {
        "chronos-2": parse_forecast(opening),
        "chronos-2-cutoff": parse_forecast(read_object(directory / "forecast-cutoff.json")),
        **{name: parse_forecast(value) for name, value in comparisons.items()},
    }
