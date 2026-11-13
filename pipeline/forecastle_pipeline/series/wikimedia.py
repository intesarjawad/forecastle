from dataclasses import dataclass
from datetime import UTC, date, datetime
from urllib.parse import quote

from forecastle_pipeline.series.base import (
    DailyPoint,
    SeriesError,
    complete_days,
    json_array,
    json_object,
    observed_value,
    validate_range,
)
from forecastle_pipeline.series.http import get_json

PAGEVIEWS_URL = "https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article"


@dataclass(frozen=True)
class WikimediaSeries:
    """Daily user pageviews across all access methods for one article."""

    project: str
    article: str

    def fetch_daily(self, start: date, end: date) -> list[DailyPoint]:
        """Fetch every requested day, with article titles encoded as one path segment."""
        validate_range(start, end)
        project = quote(self.project, safe="")
        article = quote(self.article.replace(" ", "_"), safe="")
        url = (
            f"{PAGEVIEWS_URL}/{project}/all-access/user/{article}"
            f"/daily/{start:%Y%m%d}00/{end:%Y%m%d}00"
        )
        payload = json_object(get_json(url))
        values: dict[date, float] = {}
        for raw_item in json_array(payload.get("items")):
            item = json_object(raw_item)
            timestamp = item.get("timestamp")
            if not isinstance(timestamp, str):
                msg = "Wikimedia timestamp must be a string"
                raise SeriesError(msg)
            try:
                day = datetime.strptime(timestamp, "%Y%m%d%H").replace(tzinfo=UTC).date()
            except ValueError as error:
                msg = f"Invalid Wikimedia timestamp: {timestamp}"
                raise SeriesError(msg) from error
            if day in values:
                msg = f"Duplicate daily value for {day}"
                raise SeriesError(msg)
            values[day] = observed_value(item.get("views"), day)
        return complete_days(values, start, end)
