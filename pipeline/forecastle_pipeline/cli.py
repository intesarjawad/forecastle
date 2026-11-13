import argparse
import json
import logging
import os
import shlex
import subprocess
import webbrowser
from collections.abc import Callable, Mapping, Sequence
from datetime import UTC, date, datetime, timedelta
from hashlib import file_digest
from importlib.resources import files
from pathlib import Path
from urllib.parse import quote, urlencode

import huggingface_hub

from forecastle_pipeline.core.custom import CustomSeries, build_custom_payload, encode_payload
from forecastle_pipeline.core.puzzle import (
    SeriesCandidate,
    WindowShape,
    build_puzzle,
    draw_daily_series,
    draw_end_date,
    drawing_domain,
)
from forecastle_pipeline.forecasters.base import Forecast
from forecastle_pipeline.forecasters.chronos2 import Chronos2Forecaster, ModelLock, load_forecaster
from forecastle_pipeline.io import live as live_rounds
from forecastle_pipeline.io.custom_csv import (
    MAX_LABEL_LENGTH,
    REQUIRED_ROWS,
    read_series_csv,
)
from forecastle_pipeline.io.files import (
    PuzzleIndex,
    canonical_json,
    existing_puzzle,
    forecast_sha256,
    read_index,
    read_object,
    text_field,
    write_daily,
    write_game_config,
)
from forecastle_pipeline.io.live_open import open_round
from forecastle_pipeline.io.verify import verify_round
from forecastle_pipeline.messages import MessageError, fail, format_message
from forecastle_pipeline.series.base import (
    DailyPoint,
    Series,
    SeriesError,
    SourceUnreachableError,
    json_array,
    json_object,
)
from forecastle_pipeline.series.open_meteo import ARCHIVE_URL, OpenMeteoSeries
from forecastle_pipeline.series.wikimedia import WikimediaSeries

PROBE_DAYS = 14
ERA5_MARGIN_DAYS = 12
MAX_SERIES_ATTEMPTS = 5
OPEN_METEO_ATTEMPTS = 2
CATALOGUE_PATH = Path("data/catalogue.json")
GAME_PATH = Path("data/game.json")
DEFAULT_OUT = Path("site/public/puzzles")
DEFAULT_CUSTOM_OUT = Path("forecastle-custom")
SITE_URL = "https://forecastle.intesarjawad.com/"
CHRONOS_REPO = "amazon/chronos-2"
CHRONOS_DOWNLOAD_MB = 456
WIKIPEDIA_COMPLETE_LAG_DAYS = 2
CUSTOM_VISIBLE_DAYS = 28
CUSTOM_HORIZON_DAYS = 7


def utc_now() -> datetime:
    """Supply the production clock at the command boundary."""
    return datetime.now(UTC)


def iso_date(value: str) -> date:
    """Require the CLI's extended ISO date format."""
    parsed = date.fromisoformat(value)
    if parsed.isoformat() != value:
        msg = "Dates must use YYYY-MM-DD"
        raise ValueError(msg)
    return parsed


def model_locks() -> dict[str, ModelLock]:
    """Read the pinned model identities shipped inside the package."""
    return json.loads(
        files("forecastle_pipeline").joinpath("models.lock.json").read_text(encoding="utf-8")
    )


def fetch_models(*, redownload: bool) -> None:
    """Download both pinned snapshots and verify every locked file's SHA-256."""
    for repo_id, lock in model_locks().items():
        snapshot = Path(
            huggingface_hub.snapshot_download(
                repo_id,
                revision=lock["revision"],
                force_download=redownload,
                allow_patterns=list(lock["files"]),
            )
        )
        for filename, expected in lock["files"].items():
            with (snapshot / filename).open("rb") as source:
                actual = file_digest(source, "sha256").hexdigest()
            if actual != expected:
                msg = (
                    f"{repo_id}/{filename} checksum mismatch; "
                    "run forecastle-pipeline fetch-model --redownload"
                )
                raise ValueError(msg)
        print(f"Verified {repo_id}@{lock['revision']}")


def model_cache_dir() -> Path:
    """Match huggingface_hub's default cache so the download notice is accurate."""
    configured = os.environ.get("HF_HUB_CACHE")
    if configured:
        return Path(configured)
    home = os.environ.get("HF_HOME")
    if home:
        return Path(home) / "hub"
    base = Path(os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache")))
    return base / "huggingface" / "hub"


def pinned_snapshot(repo_id: str, lock: ModelLock) -> Path:
    """Name the snapshot directory the pinned revision would occupy."""
    return (
        model_cache_dir() / f"models--{repo_id.replace('/', '--')}" / "snapshots" / lock["revision"]
    )


def load_custom_forecaster() -> Chronos2Forecaster:
    """Load chronos-2 from the pinned files, downloading once when they are absent."""
    lock = model_locks()[CHRONOS_REPO]
    if not all((pinned_snapshot(CHRONOS_REPO, lock) / name).is_file() for name in lock["files"]):
        print(f"Downloading {CHRONOS_REPO} ({CHRONOS_DOWNLOAD_MB} MB, once) to {model_cache_dir()}")
    try:
        downloaded = Path(
            huggingface_hub.snapshot_download(
                CHRONOS_REPO,
                revision=lock["revision"],
                allow_patterns=list(lock["files"]),
            )
        )
    except (OSError, ValueError) as error:
        fail("model_download", repo=CHRONOS_REPO, reason=error)
    for filename, expected in lock["files"].items():
        with (downloaded / filename).open("rb") as source:
            actual = file_digest(source, "sha256").hexdigest()
        if actual != expected:
            fail("model_hash", repo=CHRONOS_REPO, filename=filename)
    try:
        return load_forecaster("chronos-2")
    except (OSError, ValueError) as error:
        fail("model_load", reason=error)


def catalogue_entries() -> dict[str, Mapping[str, object]]:
    """Load catalogue identities, validating fields as their adapters are constructed."""
    payload: object = json.loads(CATALOGUE_PATH.read_text(encoding="utf-8"))
    entries = [json_object(item) for item in json_array(payload)]
    return {text_field(entry, "id"): entry for entry in entries}


def candidate(entry: Mapping[str, object]) -> SeriesCandidate:
    """Validate the source discriminator before handing it to the pure draw."""
    kind = entry.get("kind")
    if kind not in ("open_meteo", "wikimedia"):
        msg = f"Unknown catalogue kind: {kind}"
        raise ValueError(msg)
    return SeriesCandidate(text_field(entry, "id"), kind)


def series_source(entry: Mapping[str, object]) -> tuple[Series, dict[str, str]]:
    """Construct the source adapter and attribution from catalogue metadata."""
    if entry["kind"] == "wikimedia":
        project, article = text_field(entry, "project"), text_field(entry, "article")
        return WikimediaSeries(project, article), {
            "name": "Wikimedia Pageviews",
            "url": f"https://{project}.org/wiki/{quote(article.replace(' ', '_'), safe='')}",
            "license": "CC0-1.0",
        }
    latitude, longitude = entry.get("latitude"), entry.get("longitude")
    if not isinstance(latitude, (int, float)) or not isinstance(longitude, (int, float)):
        msg = f"Invalid coordinates for {entry['id']}"
        raise TypeError(msg)
    query = urlencode({"latitude": latitude, "longitude": longitude, "models": "era5"})
    return OpenMeteoSeries(latitude, longitude), {
        "name": "Open-Meteo ERA5",
        "url": f"{ARCHIVE_URL}?{query}",
        "license": "CC-BY-4.0",
    }


def fetch_daily_window(
    puzzle_id: str,
    candidates: list[SeriesCandidate],
    previous: list[SeriesCandidate],
    entries: Mapping[str, Mapping[str, object]],
    window: tuple[date, date],
) -> tuple[SeriesCandidate, list[DailyPoint]]:
    """Fetch the drawn window; an Open-Meteo outage gets one retry, then a Wikimedia draw."""
    log = logging.getLogger(__name__)
    failure: SeriesError | None = None
    selected = draw_daily_series(puzzle_id, candidates, previous)
    remaining = candidates
    alternate = True
    if selected.kind == "open_meteo":
        series = series_source(entries[selected.id])[0]
        for _ in range(OPEN_METEO_ATTEMPTS):
            try:
                return selected, series.fetch_daily(*window)
            except SeriesError as error:
                log.warning("Open-Meteo failed for %s: %s", selected.id, error)
        remaining = [item for item in candidates if item.kind == "wikimedia"]
        alternate = False
    for _ in range(MAX_SERIES_ATTEMPTS):
        selected = draw_daily_series(puzzle_id, remaining, previous, alternate=alternate)
        try:
            return selected, series_source(entries[selected.id])[0].fetch_daily(*window)
        except SeriesError as error:
            log.warning("Skipping %s: %s", selected.id, error)
            failure = error
            remaining = [item for item in remaining if item != selected]
    raise MessageError(format_message("series_failed", series=selected.id, reason=failure))


def make_puzzle(puzzle_day: date, run_day: date, out: Path) -> None:
    """Build a historical puzzle using only its visible context for inference."""
    puzzle_id = puzzle_day.isoformat()
    index = read_index(out)
    launch = index["launchDate"] if index else puzzle_id
    if existing_puzzle(out, puzzle_id, index):
        write_game_config(GAME_PATH, launch)
        print(f"Puzzle {puzzle_id} already exists; puzzle files unchanged")
        return
    if puzzle_id < launch:
        msg = f"Puzzle {puzzle_id} precedes immutable launchDate {launch}"
        raise ValueError(msg)
    entries = catalogue_entries()
    candidates = [candidate(entry) for entry in entries.values()]
    previous: list[SeriesCandidate] = []
    if index:
        for entry in index["puzzles"]:
            if entry["id"] < puzzle_id:
                public = read_object(out / entry["id"] / "puzzle.json")
                previous.append(candidate(entries[text_field(public, "seriesId")]))
    end = draw_end_date(puzzle_id, run_day)
    shape = WindowShape()
    start = end - timedelta(days=shape.visible + shape.horizon - 1)
    selected, points = fetch_daily_window(puzzle_id, candidates, previous, entries, (start, end))
    entry = entries[selected.id]
    source = series_source(entry)[1]
    public, answer = build_puzzle(
        [point.value for point in points], [point.date for point in points], len(points) - 1, shape
    )
    model = load_forecaster("chronos-2")
    ai: dict[str, object] = {
        "forecaster": model.repo_id,
        "revision": model.revision,
        **model.forecast(public["visible"], shape.horizon),
    }
    number = (puzzle_day - date.fromisoformat(launch)).days + 1
    puzzle: dict[str, object] = {
        "id": puzzle_id,
        "number": number,
        "kind": "historical",
        "seriesId": selected.id,
        "label": text_field(entry, "label"),
        "unit": text_field(entry, "unit"),
        "visible": public["visible"],
        "typicalMove": public["typical_move"],
        "yDomain": drawing_domain(public["y_domain"], entry["kind"]),
        "horizon": public["horizon"],
        "gapDays": public["gap_days"],
        "ai": ai,
        "forecastSha256": forecast_sha256(ai),
    }
    updated: PuzzleIndex = index or {"launchDate": launch, "puzzles": [], "live": []}
    updated["puzzles"].append(
        {
            "id": puzzle_id,
            "number": number,
            "kind": "historical",
            "label": text_field(entry, "label"),
        }
    )
    updated["puzzles"].sort(key=lambda item: item["id"])
    write_daily(out, puzzle, {"id": puzzle_id, **answer, "source": source}, updated)
    write_game_config(GAME_PATH, updated["puzzles"][0]["id"])
    print(f"Wrote puzzle {puzzle_id} to {out / puzzle_id}")


def wikipedia_series(article: str, label: str | None, now: datetime) -> CustomSeries:
    """Fetch the 35 complete days ending two UTC days ago."""
    resolved = label if label is not None else f"Daily views of the Wikipedia article {article}"
    if not resolved:
        fail("label_empty", path=f"--wikipedia {shlex.quote(article)}")
    if len(resolved) > MAX_LABEL_LENGTH:
        fail("wikipedia_label_long", length=len(resolved), argument=shlex.quote(article))
    end = now.date() - timedelta(days=WIKIPEDIA_COMPLETE_LAG_DAYS)
    try:
        points = WikimediaSeries("en.wikipedia", article).fetch_daily(
            end - timedelta(days=REQUIRED_ROWS - 1), end
        )
    except SourceUnreachableError as error:
        fail("wikipedia_unreachable", article=article, argument=shlex.quote(article), reason=error)
    except SeriesError as error:
        fail("wikipedia_failed", article=article, argument=shlex.quote(article), reason=error)
    return CustomSeries(
        resolved,
        "views",
        [point.value for point in points],
        [point.date for point in points],
    )


def run_custom(args: argparse.Namespace, now: datetime) -> None:
    """Build, write and open one custom puzzle from a file or a Wikipedia article."""
    if args.csv is not None and args.wikipedia is not None:
        fail("source_both")
    if args.wikipedia is not None:
        series = wikipedia_series(args.wikipedia, args.label, now)
        source = "Wikipedia pageviews (CC0)"
    elif args.csv is not None:
        series = read_series_csv(args.csv, label=args.label, unit=args.unit)
        source = ""
    else:
        fail("source_missing")
    model = load_custom_forecaster()
    forecast = model.forecast(series.values[:CUSTOM_VISIBLE_DAYS], CUSTOM_HORIZON_DAYS)
    ai: dict[str, object] = {
        "forecaster": model.repo_id,
        "revision": model.revision,
        **forecast,
    }
    payload, actual = build_custom_payload(series, ai, source=source)
    write_custom(args.out, payload, actual, forecast)
    link = f"{SITE_URL}#/c/{encode_payload(link_payload(payload, actual, forecast, model))}"
    print(f"Wrote puzzle, answer and forecast to {args.out}")
    print(link)
    if not args.no_open:
        webbrowser.open(link)


def link_payload(
    puzzle: Mapping[str, object],
    actual: Sequence[float],
    forecast: Forecast,
    model: Chronos2Forecaster,
) -> dict[str, object]:
    """Carry the answer in the link too: the site has no other file to read it from."""
    return {
        "v": 1,
        "label": puzzle["label"],
        "unit": puzzle["unit"],
        "source": puzzle["source"],
        "visible": puzzle["visible"],
        "actual": list(actual),
        "ai": {"median": forecast["median"], "q10": forecast["q10"], "q90": forecast["q90"]},
        "model": model.repo_id,
        "revision": model.revision,
    }


def write_custom(
    out: Path,
    payload: Mapping[str, object],
    actual: Sequence[float],
    forecast: Forecast,
) -> None:
    """Write the public payload, the seven actuals and the forecast as plain rows."""
    out.mkdir(parents=True, exist_ok=True)
    (out / "puzzle.json").write_bytes(canonical_json(payload))
    (out / "answer.json").write_bytes(
        canonical_json({"actual": list(actual), "source": payload["source"]})
    )
    rows = ["day,q10,median,q90"] + [
        f"{day + 1},{forecast['q10'][day]},{forecast['median'][day]},{forecast['q90'][day]}"
        for day in range(CUSTOM_HORIZON_DAYS)
    ]
    (out / "forecast.csv").write_text("\n".join(rows) + "\n", encoding="utf-8")


def main(argv: Sequence[str] | None = None, *, clock: Callable[[], datetime] = utc_now) -> None:
    """Run pipeline commands with an injectable clock for UTC date resolution."""
    parser = argparse.ArgumentParser(prog="forecastle-pipeline")
    commands = parser.add_subparsers(dest="command", required=True)
    make = commands.add_parser("make-puzzle", help="Write a historical daily puzzle")
    make.add_argument("--date", required=True)
    make.add_argument("--out", type=Path, default=DEFAULT_OUT)
    probe = commands.add_parser("probe", help="Print 14 complete daily observations")
    probe.add_argument("series_id", help="A catalogue id, for example meteo-oslo-tmean")
    fetch = commands.add_parser("fetch-model", help="Download and verify the pinned models")
    fetch.add_argument("--redownload", action="store_true")
    custom = commands.add_parser("custom", help="Build a puzzle from your own daily data")
    custom.add_argument("csv", nargs="?", type=Path, help="CSV file with at least 35 daily values")
    custom.add_argument(
        "--wikipedia",
        metavar="ARTICLE",
        help="Use daily views of a Wikipedia article, for example Pumpkin",
    )
    custom.add_argument("--label", help="Override the series label")
    custom.add_argument("--unit", default="", help="Unit for CSV values")
    custom.add_argument("--out", type=Path, default=DEFAULT_CUSTOM_OUT, help="Output directory")
    custom.add_argument(
        "--no-open", action="store_true", help="Do not open the puzzle in a browser"
    )
    opening = commands.add_parser("open-live-round", help="Open a sealed live round")
    opening.add_argument("--open-day", required=True)
    for command in ("close-live-round", "resolve-live-round", "verify-round"):
        live = commands.add_parser(command, help="Reveal, resolve or verify a live round")
        live.add_argument("round_id", nargs="?")
        live.add_argument("--id", dest="flagged_id")
    args = parser.parse_args(argv)
    now = clock().astimezone(UTC)
    try:
        if args.command == "make-puzzle":
            puzzle_day = now.date() if args.date == "today" else iso_date(args.date)
            make_puzzle(puzzle_day, now.date(), args.out)
        elif args.command == "fetch-model":
            fetch_models(redownload=args.redownload)
        elif args.command == "probe":
            probe_series(args.series_id, now.date())
        elif args.command == "custom":
            run_custom(args, now)
        else:
            run_live_command(args, now)
    except MessageError as error:
        parser.exit(2, f"error: {error.message.what}\nnext: {error.message.next_step}\n")
    except (SeriesError, ValueError, TypeError, OSError, subprocess.SubprocessError) as error:
        parser.exit(2, f"error: {error}\n")


def probe_series(series_id: str, today: date) -> None:
    """Print the days a daily window could use, so a failing source can be inspected."""
    entries = catalogue_entries()
    if series_id not in entries:
        msg = f"Unknown series id {series_id}; use an id from {CATALOGUE_PATH}"
        raise ValueError(msg)
    end = today - timedelta(days=ERA5_MARGIN_DAYS)
    for point in series_source(entries[series_id])[0].fetch_daily(
        end - timedelta(days=PROBE_DAYS - 1), end
    ):
        print(f"{point.date.isoformat()} {point.value}")


def run_live_command(args: argparse.Namespace, now: datetime) -> None:
    """Run explicit ids or retry all due unresolved rounds, oldest first."""
    if args.command == "open-live-round":
        round_id = open_round(iso_date(args.open_day), now, catalogue_entries())
        print(f"Opened {round_id}")
        return
    round_id = args.flagged_id or args.round_id
    if args.flagged_id and args.round_id and args.flagged_id != args.round_id:
        msg = "Positional id and --id must agree"
        raise ValueError(msg)
    if args.command == "verify-round":
        if not round_id:
            msg = "verify-round requires a round id"
            raise ValueError(msg)
        directory = live_rounds.round_directory(round_id)
        if round_id == "fixture" and not directory.exists():
            directory = Path("benchmark/fixtures/live/fixture")
        for message in verify_round(directory):
            print(message)
        return
    resolve_due_rounds(args, now, round_id)


def resolve_due_rounds(args: argparse.Namespace, now: datetime, round_id: str | None) -> None:
    """Attempt every due round even when an earlier round needs another retry."""
    ids = (
        [round_id]
        if round_id
        else live_rounds.due_rounds(now, resolve=args.command == "resolve-live-round")
    )
    entries = catalogue_entries()
    failures: list[str] = []
    for selected in ids:
        try:
            if args.command == "close-live-round":
                live_rounds.close_round(selected, now, entries)
                print(f"Closed {selected}")
            else:
                complete = live_rounds.resolve_round(selected, now, entries)
                print(f"{selected}: {'resolved' if complete else 'proof pending; retry scheduled'}")
        except (SeriesError, ValueError, OSError, subprocess.SubprocessError) as error:
            failures.append(f"{selected}: {error}")
    if failures:
        raise ValueError("; ".join(failures))
