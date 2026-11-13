import runpy
import sys
from collections.abc import Mapping
from datetime import date, datetime, timedelta
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory

from forecastle_pipeline.core.live_calendar import (
    CHARTS_PER_ROUND,
)
from forecastle_pipeline.forecasters.base import Forecast
from forecastle_pipeline.forecasters.chronos2 import load_forecaster
from forecastle_pipeline.io.export import export_submissions
from forecastle_pipeline.io.files import canonical_json, read_object, text_field
from forecastle_pipeline.io.resolve import chart_forecasts, resolve_chart, write_round
from forecastle_pipeline.io.round_schema import ResolvedRound, number, parse_round
from forecastle_pipeline.io.seal import crypt
from forecastle_pipeline.io.stamp import stamp, upgrade
from forecastle_pipeline.series.base import json_array, json_object
from forecastle_pipeline.series.wikimedia import WikimediaSeries

PUBLIC = Path("site/public/live")
SEALED = Path("sealed")
INDEX = Path("site/public/puzzles/index.json")
ROUNDS = Path("benchmark/rounds")
GAME = Path("data/game.json")
PROOFS_PER_ROUND = CHARTS_PER_ROUND * 2
MIN_DAILY_VIEWS = 500


def write_json(path: Path, payload: Mapping[str, object]) -> None:
    """Atomically publish canonical JSON without changing committed forecast bytes."""
    encoded = canonical_json(payload)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(encoded)
    temporary.replace(path)


def round_directory(round_id: str) -> Path:
    """Constrain round ids to one path component at the CLI boundary."""
    if not round_id or round_id in (".", "..") or Path(round_id).name != round_id:
        msg = "Round id must be one path component"
        raise ValueError(msg)
    return PUBLIC / round_id


def chart_paths(round_id: str) -> list[Path]:
    """Require a complete three-chart round rather than resolving partial publications."""
    directory = round_directory(round_id)
    paths = [directory / str(index) for index in range(1, 4)]
    if not all((path / "puzzle.json").is_file() for path in paths):
        msg = f"Incomplete live round {round_id}"
        raise ValueError(msg)
    return paths


def source(entry: Mapping[str, object]) -> WikimediaSeries:
    """Limit live rounds to the eligible Wikipedia catalogue sources."""
    if entry.get("kind") != "wikimedia" or entry.get("prospectiveEligible") is not True:
        msg = "Live charts require a prospective-eligible Wikimedia series"
        raise ValueError(msg)
    return WikimediaSeries(text_field(entry, "project"), text_field(entry, "article"))


def history(entry: Mapping[str, object], end: date, length: int) -> list[float]:
    """Fetch an exact trailing window without admitting observations after its end."""
    return [
        point.value for point in source(entry).fetch_daily(end - timedelta(days=length - 1), end)
    ]


def tail(forecast: Forecast) -> Forecast:
    """Discard the unscored leading gap predictions."""
    return {
        "median": forecast["median"][-7:],
        "q10": forecast["q10"][-7:],
        "q90": forecast["q90"][-7:],
    }


def update_index(round_id: str, *, resolved: bool) -> None:
    """Publish live calendar metadata while retaining the daily archive."""
    index: dict[str, object] = (
        dict(read_object(INDEX))
        if INDEX.exists()
        else {
            "launchDate": read_object(GAME).get("launchDate"),
            "puzzles": [],
            "live": [],
        }
    )
    entries = [dict(json_object(item)) for item in json_array(index["live"])]
    first = read_object(round_directory(round_id) / "1/puzzle.json")
    entries = [entry for entry in entries if entry.get("id") != round_id]
    entries.append(
        {
            "id": round_id,
            "charts": 3,
            "opensUtc": first["opensUtc"],
            "cutoffUtc": first["cutoffUtc"],
            "resolvesUtc": first["resolvesUtc"],
            "resolved": resolved,
        }
    )
    index["live"] = sorted(entries, key=lambda item: str(item["id"]))
    write_json(INDEX, index)


def close_round(round_id: str, now: datetime, entries: Mapping[str, Mapping[str, object]]) -> None:
    """Reveal committed forecasts only after cutoff and timestamp the latest fair context."""
    for directory in chart_paths(round_id):
        puzzle = dict(read_object(directory / "puzzle.json"))
        cutoff = datetime.fromisoformat(text_field(puzzle, "cutoffUtc"))
        if now <= cutoff:
            msg = "Cannot reveal a live forecast before cutoffUtc"
            raise ValueError(msg)
        target = directory / "forecast.json"
        if not target.exists():
            with TemporaryDirectory(prefix="forecastle-reveal-") as temporary:
                decrypted = Path(temporary) / "forecast.json"
                crypt(
                    SEALED / round_id / directory.name / "forecast.json.enc",
                    decrypted,
                    decrypt=True,
                )
                if sha256(decrypted.read_bytes()).hexdigest() != puzzle["forecastSha256"]:
                    msg = f"SHA-256 mismatch for {target}"
                    raise ValueError(msg)
                target.write_bytes(decrypted.read_bytes())
        elif sha256(target.read_bytes()).hexdigest() != puzzle["forecastSha256"]:
            msg = f"SHA-256 mismatch for {target}"
            raise ValueError(msg)
        at_cutoff = directory / "forecast-cutoff.json"
        if not at_cutoff.exists():
            model = load_forecaster("chronos-2")
            context = history(
                entries[text_field(puzzle, "seriesId")], cutoff.date() - timedelta(days=1), 28
            )
            write_json(
                at_cutoff,
                {
                    "forecaster": model.repo_id,
                    "revision": model.revision,
                    **tail(model.forecast(context, 8)),
                },
            )
        digest = sha256(at_cutoff.read_bytes()).hexdigest()
        if "cutoffForecastSha256" in puzzle and puzzle["cutoffForecastSha256"] != digest:
            msg = f"SHA-256 mismatch for {at_cutoff}"
            raise ValueError(msg)
        stamp(at_cutoff)
        puzzle["cutoffForecastSha256"] = digest
        write_json(directory / "puzzle.json", puzzle)


def run_report() -> None:
    """Regenerate the statistics report, failing resolution if reporting is unavailable."""
    script = Path("scripts/benchmark_report.py")
    if not script.is_file():
        msg = "scripts/benchmark_report.py is required to finish resolution"
        raise FileNotFoundError(msg)
    previous = sys.argv
    try:
        sys.argv = [str(script)]
        runpy.run_path(str(script), run_name="__main__")
    finally:
        sys.argv = previous


def resolve_round(
    round_id: str, now: datetime, entries: Mapping[str, Mapping[str, object]]
) -> bool:
    """Resume incomplete resolution using immutable evidence and scheduled proof retries."""
    directories = chart_paths(round_id)
    first = read_object(directories[0] / "puzzle.json")
    due = datetime.fromisoformat(text_field(first, "resolvesUtc"))
    if now < due:
        msg = "Round has not reached resolvesUtc"
        raise ValueError(msg)
    check_commitments(directories)
    destination = ROUNDS / f"{round_id}.json"
    if destination.exists():
        resolved = parse_round(read_object(destination))
        if resolved["id"] != round_id:
            msg = "Resolved evidence does not match the requested round id"
            raise ValueError(msg)
    else:
        k = number(read_object(Path("scoring/constants.json"))["k"], positive=True)
        resolved: ResolvedRound = {
            "schemaVersion": 1,
            "id": round_id,
            "openDay": datetime.fromisoformat(text_field(first, "opensUtc")).date().isoformat(),
            "cutoffUtc": text_field(first, "cutoffUtc"),
            "charts": [],
        }
        for directory in directories:
            puzzle = read_object(directory / "puzzle.json")
            days = [date.fromisoformat(str(item)) for item in json_array(puzzle["scoredDates"])]
            values = [
                point.value
                for point in source(entries[text_field(puzzle, "seriesId")]).fetch_daily(
                    days[0], days[-1]
                )
            ]
            submissions = export_submissions(text_field(puzzle, "id"), GAME)
            resolved["charts"].append(
                resolve_chart(puzzle, chart_forecasts(directory), values, submissions, k)
            )
        write_round(destination, resolved)
    _publish_answers(resolved, directories)
    states = [
        upgrade(proof) for directory in directories for proof in sorted(directory.glob("*.ots"))
    ]
    if len(states) != PROOFS_PER_ROUND:
        msg = "Resolution requires opening and cutoff proofs for all three charts"
        raise ValueError(msg)
    if "pending" in states:
        if now >= due.replace(hour=18):
            msg = "Timestamp still pending at the final resolve retry; run ots upgrade"
            raise ValueError(msg)
        return False
    run_report()
    update_index(round_id, resolved=True)
    return True


def due_rounds(now: datetime, *, resolve: bool) -> list[str]:
    """Include older unresolved rounds on every scheduled retry, in opening order."""
    result: list[str] = []
    for directory in sorted(PUBLIC.glob("live-*")):
        first = read_object(directory / "1/puzzle.json")
        field = "resolvesUtc" if resolve else "cutoffUtc"
        due = datetime.fromisoformat(text_field(first, field))
        reached = now >= due if resolve else now > due
        if reached and (not resolve or not _indexed_resolved(directory.name)):
            result.append(directory.name)
    return result


def _indexed_resolved(round_id: str) -> bool:
    if not INDEX.exists():
        return False
    return any(
        json_object(item).get("id") == round_id and json_object(item).get("resolved") is True
        for item in json_array(read_object(INDEX)["live"])
    )


def _publish_answers(resolved: ResolvedRound, directories: list[Path]) -> None:
    for chart, directory in zip(resolved["charts"], directories, strict=True):
        answer: dict[str, object] = {
            "id": chart["id"],
            "dates": chart["scoredDates"],
            "actual": chart["actual"],
            "source": {"name": "Wikimedia Pageviews", "license": "CC0-1.0"},
        }
        if "crowd" in chart:
            answer["crowd"] = chart["crowd"]
        write_json(directory / "answer.json", answer)


def check_commitments(directories: list[Path]) -> None:
    """Recheck opening and cutoff hashes on every resolution attempt."""
    for directory in directories:
        puzzle = read_object(directory / "puzzle.json")
        for filename, field in (
            ("forecast.json", "forecastSha256"),
            ("forecast-cutoff.json", "cutoffForecastSha256"),
        ):
            if sha256((directory / filename).read_bytes()).hexdigest() != puzzle.get(field):
                msg = f"SHA-256 mismatch for {directory / filename}"
                raise ValueError(msg)
