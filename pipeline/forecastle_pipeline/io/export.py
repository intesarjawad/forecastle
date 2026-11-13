import os
from pathlib import Path
from urllib.parse import quote

from forecastle_pipeline.io.files import read_object
from forecastle_pipeline.series.base import SeriesError, json_array, json_object
from forecastle_pipeline.series.http import get_json

EXPORT_ATTEMPTS = 3


def export_submissions(chart_id: str, game_path: Path) -> list[object]:
    """Fetch {submissions: [D1 rows]} for one chart; never persist client identifiers."""
    url = read_object(game_path).get("workerUrl")
    if not isinstance(url, str) or not url.startswith("https://"):
        msg = "Set a nonempty HTTPS workerUrl in data/game.json before resolution"
        raise ValueError(msg)
    token = os.environ.get("EXPORT_TOKEN", "")
    if not token:
        msg = "EXPORT_TOKEN is required for resolution"
        raise ValueError(msg)
    endpoint = f"{url.rstrip('/')}/v1/export/{quote(chart_id, safe='')}"
    for attempt in range(EXPORT_ATTEMPTS):
        try:
            payload = json_object(get_json(endpoint, token=token))
            return json_array(payload.get("submissions"))
        except SeriesError:
            if attempt == EXPORT_ATTEMPTS - 1:
                raise
    msg = "Export attempts exhausted"
    raise SeriesError(msg)
