import base64
import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, timedelta
from hashlib import sha256

from forecastle_pipeline.core.puzzle import WindowShape, build_puzzle
from forecastle_pipeline.messages import fail

DAILY_ROWS = 35
PAYLOAD_LIMIT = 4096
# build_puzzle only needs consecutive dates; a custom payload never carries them.
INDEX_START = date(2000, 1, 1)


@dataclass(frozen=True)
class CustomSeries:
    """One daily series read from a user's file, with dates only when supplied."""

    label: str
    unit: str
    values: list[float]
    dates: list[date] | None


def build_custom_payload(
    series: CustomSeries,
    forecast: Mapping[str, object],
    *,
    source: str,
) -> tuple[dict[str, object], list[float]]:
    """Split the last 35 values into a public payload and the seven actuals."""
    if len(series.values) != DAILY_ROWS:
        msg = f"Custom puzzles need exactly {DAILY_ROWS} daily values"
        raise ValueError(msg)
    dates = (
        series.dates
        if series.dates is not None
        else [INDEX_START + timedelta(days=index) for index in range(DAILY_ROWS)]
    )
    public, answer = build_puzzle(series.values, dates, DAILY_ROWS - 1, WindowShape())
    ai = dict(forecast)
    payload: dict[str, object] = {
        "kind": "custom",
        "label": series.label,
        "unit": series.unit,
        "source": source,
        "visible": public["visible"],
        "typicalMove": public["typical_move"],
        "yDomain": list(public["y_domain"]),
        "horizon": public["horizon"],
        "gapDays": public["gap_days"],
        "ai": ai,
        "forecastSha256": sha256(_canonical_json(ai).encode()).hexdigest(),
    }
    return payload, list(answer["actual"])


def encode_payload(payload: Mapping[str, object]) -> str:
    """Encode canonical JSON as unpadded base64url for a custom link."""
    encoded = base64.urlsafe_b64encode(_canonical_json(payload).encode()).decode().rstrip("=")
    if len(encoded) > PAYLOAD_LIMIT:
        fail("payload_large", length=len(encoded), limit=PAYLOAD_LIMIT)
    return encoded


def _canonical_json(payload: Mapping[str, object]) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False)
