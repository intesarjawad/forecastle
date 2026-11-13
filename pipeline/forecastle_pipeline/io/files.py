import json
from collections.abc import Mapping
from datetime import date
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import TypedDict

from forecastle_pipeline.series.base import SeriesError, json_array, json_object


class PuzzleEntry(TypedDict):
    """Archive metadata shared with the corresponding public puzzle."""

    id: str
    number: int
    kind: str
    label: str


class PuzzleIndex(TypedDict):
    """Daily archive and live-round metadata published beside the puzzles."""

    launchDate: str
    puzzles: list[PuzzleEntry]
    live: list[object]


def canonical_json(value: Mapping[str, object]) -> bytes:
    """Encode forecast commitments without whitespace or a trailing newline."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def forecast_sha256(ai: Mapping[str, object]) -> str:
    """Hash the canonical AI object, including model identity and quantiles."""
    return sha256(canonical_json(ai)).hexdigest()


def read_object(path: Path) -> Mapping[str, object]:
    """Read a JSON object, preserving the offending path in boundary errors."""
    try:
        payload: object = json.loads(path.read_text(encoding="utf-8"))
        return json_object(payload)
    except (ValueError, SeriesError) as error:
        msg = f"Invalid JSON object in {path}: {error}"
        raise ValueError(msg) from error


def text_field(payload: Mapping[str, object], key: str) -> str:
    """Require nonempty text in persisted metadata."""
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        msg = f"Expected nonempty text for {key}"
        raise ValueError(msg)
    return value


def read_index(out: Path) -> PuzzleIndex | None:
    """Validate an existing index instead of replacing malformed archive history."""
    path = out / "index.json"
    if not path.exists():
        return None
    try:
        raw = read_object(path)
        return _parse_index(raw)
    except (ValueError, SeriesError) as error:
        msg = f"Invalid index {path}: {error}"
        raise ValueError(msg) from error


def _parse_index(raw: Mapping[str, object]) -> PuzzleIndex:
    launch = text_field(raw, "launchDate")
    date.fromisoformat(launch)
    entries: list[PuzzleEntry] = []
    for item in json_array(raw.get("puzzles")):
        entry = json_object(item)
        puzzle_id = text_field(entry, "id")
        number = entry.get("number")
        if (
            type(number) is not int
            or number != (date.fromisoformat(puzzle_id) - date.fromisoformat(launch)).days + 1
        ):
            msg = f"Invalid puzzle number for {puzzle_id}"
            raise ValueError(msg)
        if entry.get("kind") != "historical":
            msg = f"Invalid daily puzzle kind for {puzzle_id}"
            raise ValueError(msg)
        entries.append(
            {
                "id": puzzle_id,
                "number": number,
                "kind": "historical",
                "label": text_field(entry, "label"),
            }
        )
    ids = [entry["id"] for entry in entries]
    if ids != sorted(set(ids)) or not ids or ids[0] != launch:
        msg = "Puzzle ids must be unique, sorted, and start at launchDate"
        raise ValueError(msg)
    return {"launchDate": launch, "puzzles": entries, "live": json_array(raw.get("live"))}


def existing_puzzle(out: Path, puzzle_id: str, index: PuzzleIndex | None) -> bool:
    """Treat complete indexed dates as immutable; reject partially written dates."""
    directory = out / puzzle_id
    indexed = index is not None and any(entry["id"] == puzzle_id for entry in index["puzzles"])
    if not directory.exists() and not indexed:
        return False
    if indexed and all((directory / name).is_file() for name in ("puzzle.json", "answer.json")):
        return True
    msg = (
        f"Incomplete puzzle {puzzle_id} at {directory}; restore its files and index before retrying"
    )
    raise ValueError(msg)


def write_game_config(game_path: Path, launch: str) -> None:
    """Derive launch metadata from the archive while preserving deployment settings."""
    configuration: dict[str, object] = (
        dict(read_object(game_path))
        if game_path.exists()
        else {"liveChartsPerRound": 3, "workerUrl": "", "submitRateSchedule": []}
    )
    if configuration.get("launchDate") == launch:
        return
    configuration["launchDate"] = launch
    encoded = (json.dumps(configuration, indent=2, allow_nan=False) + "\n").encode()
    game_path.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix=".game-", dir=game_path.parent) as temporary:
        staged = Path(temporary) / "game.json"
        staged.write_bytes(encoded)
        staged.replace(game_path)


def write_daily(
    out: Path,
    puzzle: Mapping[str, object],
    answer: Mapping[str, object],
    index: PuzzleIndex,
) -> None:
    """Stage a complete daily pair before publishing it and atomically replace the index."""
    puzzle_id = text_field(puzzle, "id")
    if puzzle_id != date.fromisoformat(puzzle_id).isoformat() or answer.get("id") != puzzle_id:
        msg = "Puzzle and answer must share an ISO daily id"
        raise ValueError(msg)
    if (out / puzzle_id).exists():
        msg = f"Refusing to overwrite existing puzzle {puzzle_id}"
        raise FileExistsError(msg)
    # Serialize before publishing anything, including rejection of nonfinite numbers.
    puzzle_bytes = canonical_json(puzzle)
    answer_bytes = canonical_json(answer)
    index_bytes = canonical_json(index)
    out.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix=".daily-", dir=out) as temporary:
        stage = Path(temporary)
        pair = stage / puzzle_id
        pair.mkdir()
        (pair / "puzzle.json").write_bytes(puzzle_bytes)
        (pair / "answer.json").write_bytes(answer_bytes)
        (stage / "index.json").write_bytes(index_bytes)
        pair.rename(out / puzzle_id)
        (stage / "index.json").replace(out / "index.json")
