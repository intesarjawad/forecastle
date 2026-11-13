import argparse
import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import numpy as np
from forecastle_pipeline.cli import candidate, catalogue_entries, series_source
from forecastle_pipeline.core.baselines import flat
from forecastle_pipeline.core.puzzle import (
    ERA5_FETCH_LAG_DAYS,
    FIRST_END_DATE,
    RECENT_PUZZLES,
    SeriesCandidate,
    WindowShape,
    build_puzzle,
)
from forecastle_pipeline.core.scoring import closeness
from forecastle_pipeline.forecasters.chronos2 import load_forecaster
from forecastle_pipeline.series.base import (
    DailyPoint,
    Series,
    complete_days,
    json_array,
    json_object,
    observed_value,
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
PUZZLE_COUNT = 300
BOOTSTRAP_RESAMPLES = 2000
SEED = 0


@dataclass(frozen=True)
class Draw:
    """One historical window selected before observing either forecast's score."""

    series: SeriesCandidate
    end: date


def draw_puzzles(candidates: Sequence[SeriesCandidate], run_day: date) -> list[Draw]:
    """Apply daily eligibility and inclusive historical bounds with calibration seed 0."""
    rng = np.random.default_rng(SEED)
    latest = run_day - timedelta(days=ERA5_FETCH_LAG_DAYS)
    if latest < FIRST_END_DATE:
        msg = "Run date leaves no historical windows"
        raise ValueError(msg)
    draws: list[Draw] = []
    for _ in range(PUZZLE_COUNT):
        recent = {draw.series.id for draw in draws[-RECENT_PUZZLES:]}
        previous_kind = draws[-1].series.kind if draws else None
        eligible = sorted(
            (item for item in candidates if item.id not in recent and item.kind != previous_kind),
            key=lambda item: item.id,
        )
        if not eligible:
            msg = "No series satisfies daily eligibility rules"
            raise ValueError(msg)
        offset = int(rng.integers((latest - FIRST_END_DATE).days + 1))
        selected = eligible[int(rng.integers(len(eligible)))]
        draws.append(Draw(selected, FIRST_END_DATE + timedelta(days=offset)))
    return draws


def cached_points(source: Series, cache: Path, start: date, end: date) -> list[DailyPoint]:
    """Cache complete source observations, validating cached values before reuse."""
    if cache.exists():
        payload: object = json.loads(cache.read_text(encoding="utf-8"))
        values: dict[date, float] = {}
        for raw in json_array(payload):
            item = json_object(raw)
            raw_day = item.get("date")
            if not isinstance(raw_day, str):
                msg = f"Invalid date in {cache}"
                raise TypeError(msg)
            day = date.fromisoformat(raw_day)
            values[day] = observed_value(item.get("value"), day)
        return complete_days(values, start, end)
    points = source.fetch_daily(start, end)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(
        json.dumps([{"date": point.date.isoformat(), "value": point.value} for point in points])
        + "\n",
        encoding="utf-8",
    )
    return points


def calibrated_k(ratios: Sequence[float]) -> tuple[float, list[float]]:
    """Estimate twice the median scaled flat MAE and its percentile bootstrap interval."""
    values = np.asarray(ratios, dtype=np.float64)
    if not len(values) or not np.isfinite(values).all() or (values < 0).any():
        msg = "Calibration requires finite, nonnegative scaled errors"
        raise ValueError(msg)
    k = 2 * float(np.median(values))
    if k <= 0:
        msg = "Median flat-line error must be positive to calibrate k"
        raise ValueError(msg)
    rng = np.random.default_rng(SEED)
    samples = rng.choice(values, size=(BOOTSTRAP_RESAMPLES, len(values)), replace=True)
    interval = np.quantile(2 * np.median(samples, axis=1), [0.025, 0.975])
    return k, [float(value) for value in interval]


def main() -> int:
    """Measure historical scores and update only the production calibration constants."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-date", type=date.fromisoformat, default=datetime.now(UTC).date())
    args = parser.parse_args()
    entries = catalogue_entries()
    draws = draw_puzzles([candidate(entry) for entry in entries.values()], args.run_date)
    shape = WindowShape()
    model = load_forecaster("chronos-2")
    flat_ratios: list[float] = []
    windows: list[tuple[list[float], list[float], list[float], float]] = []
    for index, draw in enumerate(draws):
        start = draw.end - timedelta(days=shape.visible + shape.horizon - 1)
        source, _ = series_source(entries[draw.series.id])
        cache = PROJECT_ROOT / ".cache" / "calibration" / draw.series.id
        points = cached_points(source, cache / f"{start}_{draw.end}.json", start, draw.end)
        public, answer = build_puzzle(
            [point.value for point in points],
            [point.date for point in points],
            len(points) - 1,
            shape,
        )
        visible, actual, move = public["visible"], answer["actual"], public["typical_move"]
        baseline = flat(visible, shape.horizon)["median"]
        opponent = model.forecast(visible, shape.horizon)["median"]
        flat_ratios.append(
            sum(abs(value - target) for value, target in zip(baseline, actual, strict=True))
            / shape.horizon
            / move
        )
        windows.append((baseline, opponent, actual, move))
        print(
            f"Measured {index + 1}/{PUZZLE_COUNT}: {draw.series.id} ending {draw.end}", flush=True
        )
    k, interval = calibrated_k(flat_ratios)
    flat_scores = [closeness(path, actual, move, k) for path, _, actual, move in windows]
    opponent_scores = [
        closeness(opponent, actual, move, k) for _, opponent, actual, move in windows
    ]
    constants_path = PROJECT_ROOT / "scoring" / "constants.json"
    constants = dict(json_object(json.loads(constants_path.read_text(encoding="utf-8"))))
    constants.update(k=k, kInterval=interval)
    content = ",\n".join(
        f"  {json.dumps(key)}: {json.dumps(value, allow_nan=False)}"
        for key, value in constants.items()
    )
    constants_path.write_text("{\n" + content + "\n}\n", encoding="utf-8")
    print(f"Run date: {args.run_date}; n = {PUZZLE_COUNT}; seed = {SEED}")
    print(f"k = {k}; 95% bootstrap interval = {interval}")
    for name, scores in (("Chronos-2", opponent_scores), ("Flat line", flat_scores)):
        print(f"{name} Closeness quartiles: {np.quantile(scores, [0.25, 0.5, 0.75]).tolist()}")
    wins = sum(
        opponent > baseline for opponent, baseline in zip(opponent_scores, flat_scores, strict=True)
    )
    print(f"Chronos-2 beats flat line: {wins}/{PUZZLE_COUNT} = {wins / PUZZLE_COUNT:.6f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
