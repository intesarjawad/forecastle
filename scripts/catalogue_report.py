import argparse
import json
from datetime import date, timedelta
from pathlib import Path
from statistics import median

from forecastle_pipeline.series.base import SeriesError, json_array, json_object
from forecastle_pipeline.series.wikimedia import WikimediaSeries

CATALOGUE = Path(__file__).resolve().parents[1] / "data/catalogue.json"
WINDOW_DAYS = 90


def render_report(end: date) -> str:
    """Print dated medians for the historical-only Wikimedia catalogue entries."""
    start = end - timedelta(days=WINDOW_DAYS - 1)
    entries = [json_object(row) for row in json_array(json.loads(CATALOGUE.read_text()))]
    rows = [
        f"Daily user pageviews, {start} through {end}, inclusive, across all access methods.",
        "",
        "| Article | Median daily views |",
        "| --- | ---: |",
    ]
    for entry in entries:
        if entry["kind"] != "wikimedia" or entry["prospectiveEligible"]:
            continue
        article = str(entry["article"])
        points = WikimediaSeries(str(entry["project"]), article).fetch_daily(start, end)
        rows.append(f"| {article} | {median(point.value for point in points):g} |")
    return "\n".join(rows)


def main() -> None:
    """Fetch every observation through the same complete-day adapter used by the pipeline."""
    parser = argparse.ArgumentParser(description="Report historical-only catalogue medians")
    parser.add_argument("--end", required=True, type=date.fromisoformat, help="Inclusive end date")
    args = parser.parse_args()
    try:
        print(render_report(args.end))
    except (OSError, ValueError, SeriesError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
