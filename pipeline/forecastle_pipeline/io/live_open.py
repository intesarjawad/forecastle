import logging
from collections.abc import Mapping
from datetime import date, datetime
from hashlib import sha256
from pathlib import Path
from statistics import median
from tempfile import TemporaryDirectory

from forecastle_pipeline.core.baselines import flat, seasonal_naive_7
from forecastle_pipeline.core.live_calendar import draw_live_articles, live_round_dates
from forecastle_pipeline.core.puzzle import drawing_domain
from forecastle_pipeline.core.scoring import typical_move
from forecastle_pipeline.forecasters.chronos2 import load_forecaster
from forecastle_pipeline.io import live
from forecastle_pipeline.io.files import canonical_json, read_object, text_field
from forecastle_pipeline.io.seal import crypt
from forecastle_pipeline.io.stamp import stamp
from forecastle_pipeline.series.base import SeriesError

MIN_DAILY_VIEWS = 500


def open_round(open_day: date, now: datetime, entries: Mapping[str, Mapping[str, object]]) -> str:
    """Publish only hashes, proofs and encrypted forecasts during the entry window."""
    dates = live_round_dates(open_day)
    round_id = f"live-{open_day}"
    if not dates.opens_utc <= now <= dates.cutoff_utc:
        msg = "Opening is allowed only between opensUtc and cutoffUtc"
        raise ValueError(msg)
    if live.round_directory(round_id).exists():
        live.chart_paths(round_id)
        live.update_index(round_id, resolved=False)
        return round_id
    previous: dict[date, list[str]] = {}
    for path in sorted(live.PUBLIC.glob("live-*")):
        previous[date.fromisoformat(path.name.removeprefix("live-"))] = [
            text_field(read_object(chart / "puzzle.json"), "seriesId")
            for chart in live.chart_paths(path.name)
        ]
    selected, contexts = _draw_contexts(open_day, dates.visible_end, entries, previous)
    opponent = load_forecaster("chronos-2")
    small = load_forecaster("chronos-2-small")
    long = load_forecaster("chronos-2-long")
    with TemporaryDirectory(prefix="forecastle-live-") as temporary:
        stage = Path(temporary)
        for index, series_id in enumerate(selected, 1):
            entry = entries[series_id]
            context = contexts[series_id]
            visible = context[-28:]
            public = stage / "public" / str(index)
            encrypted = stage / "encrypted" / str(index)
            public.mkdir(parents=True)
            encrypted.mkdir(parents=True)
            forecast = {
                "forecaster": opponent.repo_id,
                "revision": opponent.revision,
                **live.tail(opponent.forecast(visible, 10)),
                "comparisons": {
                    "chronos-2-small": live.tail(small.forecast(visible, 10)),
                    "chronos-2-long": live.tail(long.forecast(context, 10)),
                    "seasonal-naive-7": live.tail(seasonal_naive_7(visible, 10)),
                    "flat": live.tail(flat(visible, 10)),
                },
            }
            plaintext = public / "forecast.json"
            plaintext.write_bytes(canonical_json(forecast))
            digest = sha256(plaintext.read_bytes()).hexdigest()
            stamp(plaintext)
            crypt(plaintext, encrypted / "forecast.json.enc")
            plaintext.unlink()
            padding = 0.4 * (max(visible) - min(visible))
            live.write_json(
                public / "puzzle.json",
                {
                    "id": f"{round_id}-{index}",
                    "number": index,
                    "kind": "prospective",
                    "seriesId": series_id,
                    "label": text_field(entry, "label"),
                    "unit": text_field(entry, "unit"),
                    "visible": visible,
                    "typicalMove": typical_move(visible),
                    "yDomain": drawing_domain(
                        (min(visible) - padding, max(visible) + padding), entry["kind"]
                    ),
                    "horizon": 7,
                    "gapDays": 3,
                    "forecastSha256": digest,
                    "opensUtc": dates.opens_utc.isoformat(),
                    "cutoffUtc": dates.cutoff_utc.isoformat(),
                    "resolvesUtc": dates.resolves_utc.isoformat(),
                    "scoredDates": [day.isoformat() for day in dates.scored_dates],
                },
            )
        live.PUBLIC.mkdir(parents=True, exist_ok=True)
        live.SEALED.mkdir(parents=True, exist_ok=True)
        # Temporary files and plaintext are outside the deployed tree, including on failure.
        (stage / "encrypted").rename(live.SEALED / round_id)
        (stage / "public").rename(live.round_directory(round_id))
    live.update_index(round_id, resolved=False)
    return round_id


def _draw_contexts(
    open_day: date,
    visible_end: date,
    entries: Mapping[str, Mapping[str, object]],
    previous: Mapping[date, list[str]],
) -> tuple[tuple[str, ...], dict[str, list[float]]]:
    eligible = [
        key
        for key, entry in entries.items()
        if entry.get("prospectiveEligible") is True and entry.get("kind") == "wikimedia"
    ]
    contexts: dict[str, list[float]] = {}
    while True:
        selected = draw_live_articles(open_day, eligible, previous)
        rejected: list[str] = []
        for series_id in selected:
            if series_id not in contexts:
                try:
                    contexts[series_id] = live.history(entries[series_id], visible_end, 365)
                except SeriesError as error:
                    logging.getLogger(__name__).warning("Skipping %s: %s", series_id, error)
                    rejected.append(series_id)
                    continue
            if median(contexts[series_id][-90:]) < MIN_DAILY_VIEWS:
                logging.getLogger(__name__).warning(
                    "Skipping %s: median below 500 daily views", series_id
                )
                rejected.append(series_id)
        if not rejected:
            break
        eligible = [key for key in eligible if key not in rejected]
    return selected, contexts
