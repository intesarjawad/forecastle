import re
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path

from forecastle_pipeline.core.live_calendar import CHARTS_PER_ROUND
from forecastle_pipeline.io.files import read_object, text_field
from forecastle_pipeline.io.stamp import run_ots
from forecastle_pipeline.series.base import json_object
from forecastle_pipeline.series.http import get_json, get_text

EXPLORER = "https://blockstream.info/api"
BITCOIN_ROOT = re.compile(r"check that Bitcoin block (\d+) has merkleroot ([0-9a-f]{64})")


def verify_file(path: Path, expected_sha256: str) -> list[str]:
    """Check exact file bytes, then match the proof's Bitcoin roots to public blocks."""
    if sha256(path.read_bytes()).hexdigest() != expected_sha256:
        msg = f"SHA-256 mismatch for {path}"
        raise ValueError(msg)
    # Keep the default calendar whitelist: it is what upgrades a pending attestation.
    result = run_ots(["-v", "--no-bitcoin", "verify", f"{path}.ots"])
    # Version 0.8.0 exits 1 without a local node, even for a valid anchored proof.
    if "File does not match original" in result.stderr:
        msg = f"File does not match original timestamp: {path}"
        raise ValueError(msg)
    roots = BITCOIN_ROOT.findall(result.stderr)
    if result.returncode not in (0, 1) or not roots:
        msg = f"{path}: not yet anchored in Bitcoin; run ots upgrade"
        raise ValueError(msg)
    verified: list[str] = []
    for height, merkle_root in roots:
        block_hash = get_text(f"{EXPLORER}/block-height/{height}").strip()
        if re.fullmatch(r"[0-9a-f]{64}", block_hash) is None:
            msg = "Explorer returned an invalid block hash"
            raise ValueError(msg)
        block = json_object(get_json(f"{EXPLORER}/block/{block_hash}"))
        timestamp = block.get("timestamp")
        if (
            block.get("id") != block_hash
            or block.get("height") != int(height)
            or block.get("merkle_root") != merkle_root
            or type(timestamp) is not int
        ):
            msg = f"Bitcoin block {height} does not match the timestamp proof"
            raise ValueError(msg)
        proof_time = datetime.fromtimestamp(timestamp, UTC).isoformat()
        verified.append(f"{path}: Bitcoin block {height}, proof time {proof_time}")
    return verified


def verify_round(directory: Path) -> list[str]:
    """Verify both opening and cutoff commitments for every chart in a published round."""
    puzzles = sorted(directory.glob("*/puzzle.json"))
    if len(puzzles) != CHARTS_PER_ROUND:
        msg = f"Expected three chart puzzles in {directory}"
        raise ValueError(msg)
    messages: list[str] = []
    for puzzle_path in puzzles:
        puzzle = read_object(puzzle_path)
        for filename, field in (
            ("forecast.json", "forecastSha256"),
            ("forecast-cutoff.json", "cutoffForecastSha256"),
        ):
            messages.extend(verify_file(puzzle_path.parent / filename, text_field(puzzle, field)))
    return messages
