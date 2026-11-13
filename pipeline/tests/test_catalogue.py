import json
import time
from collections import Counter
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from math import isfinite
from pathlib import Path
from statistics import median

import pytest
from forecastle_pipeline.series.base import json_array, json_object
from forecastle_pipeline.series.wikimedia import WikimediaSeries

CATALOGUE_PATH = Path(__file__).resolve().parents[2] / "data" / "catalogue.json"
WIKIMEDIA_THEMES = frozenset(
    {"sky", "food", "seasons", "nature", "games", "sport", "landmarks", "science"}
)
# Representative exclusions, checked alongside a manual review of every catalogue title.
DENIED_TITLES = {
    "living_person": {"Lionel Messi", "Taylor Swift", "Elon Musk", "Cristiano Ronaldo"},
    "politics": {
        "Donald Trump",
        "United States presidential election",
        "Politics",
        "Political party",
    },
    "finance": {"Bitcoin", "Stock market", "Exchange rate"},
    "medical": {"Cancer", "Diabetes", "COVID-19"},
}
REQUEST_INTERVAL_SECONDS = 1


def catalogue() -> list[Mapping[str, object]]:
    with CATALOGUE_PATH.open(encoding="utf-8") as source:
        payload: object = json.load(source)
    return [json_object(entry) for entry in json_array(payload)]


ENTRIES = catalogue()
WIKIMEDIA_ENTRIES = [entry for entry in ENTRIES if entry["kind"] == "wikimedia"]


def nonempty_text(entry: Mapping[str, object], field: str) -> str:
    value = entry[field]
    assert isinstance(value, str), (entry["id"], field)
    assert value, (entry["id"], field)
    assert value.strip() == value, (entry["id"], field)
    return value


def test_catalogue_counts_and_themes() -> None:
    assert len(ENTRIES) == 60
    assert Counter(entry["kind"] for entry in ENTRIES) == {"wikimedia": 44, "open_meteo": 16}
    themes = Counter(nonempty_text(entry, "theme") for entry in ENTRIES)
    assert themes.keys() == WIKIMEDIA_THEMES | {"weather"}
    assert all(count >= 4 for count in themes.values())
    assert {entry["theme"] for entry in WIKIMEDIA_ENTRIES} == WIKIMEDIA_THEMES


def test_catalogue_unique_ids_and_sources() -> None:
    assert len({entry["id"] for entry in ENTRIES}) == len(ENTRIES)
    assert len({(entry["project"], entry["article"]) for entry in WIKIMEDIA_ENTRIES}) == 44
    cities = [entry for entry in ENTRIES if entry["kind"] == "open_meteo"]
    assert len({(entry["latitude"], entry["longitude"]) for entry in cities}) == 16
    assert any(
        isinstance(entry["latitude"], (int, float)) and entry["latitude"] < 0 for entry in cities
    )
    assert any(
        isinstance(entry["latitude"], (int, float)) and entry["latitude"] > 0 for entry in cities
    )


@pytest.mark.parametrize("entry", ENTRIES, ids=[str(entry["id"]) for entry in ENTRIES])
def test_catalogue_entry_schema(entry: Mapping[str, object]) -> None:
    for field in ("id", "kind", "theme", "label", "unit", "why"):
        nonempty_text(entry, field)
    assert isinstance(entry["prospectiveEligible"], bool)
    common = {"id", "kind", "theme", "label", "unit", "why", "prospectiveEligible"}
    if entry["kind"] == "wikimedia":
        assert entry.keys() == common | {"project", "article"}
        assert entry["project"] == "en.wikipedia"
        article = nonempty_text(entry, "article")
        assert entry["id"] == "wiki-en-" + article.replace(" ", "_")
        assert entry["label"] == f"Daily views of the Wikipedia article {article}"
        assert entry["unit"] == "views"
        assert entry["theme"] in WIKIMEDIA_THEMES
    else:
        assert entry["kind"] == "open_meteo"
        assert entry.keys() == common | {"latitude", "longitude"}
        for coordinate, bound in (("latitude", 90), ("longitude", 180)):
            value = entry[coordinate]
            assert isinstance(value, (int, float))
            assert not isinstance(value, bool)
            assert isfinite(value)
            assert -bound <= value <= bound
        assert entry["theme"] == "weather"
        assert entry["unit"] == "°C"
        assert entry["prospectiveEligible"] is False
        assert nonempty_text(entry, "id").startswith("meteo-")
        assert nonempty_text(entry, "id").endswith("-tmean")
        assert nonempty_text(entry, "label").startswith("Daily mean temperature, ")


def test_catalogue_excludes_denied_titles() -> None:
    denied = {
        title.replace("_", " ").casefold() for titles in DENIED_TITLES.values() for title in titles
    }
    for entry in WIKIMEDIA_ENTRIES:
        assert nonempty_text(entry, "article").replace("_", " ").casefold() not in denied


def test_catalogue_has_live_candidates() -> None:
    assert any(entry["prospectiveEligible"] for entry in WIKIMEDIA_ENTRIES)


@pytest.mark.slow
@pytest.mark.parametrize("entry", WIKIMEDIA_ENTRIES, ids=[str(e["id"]) for e in WIKIMEDIA_ENTRIES])
def test_wikimedia_live_completeness_and_eligibility(entry: Mapping[str, object]) -> None:
    # Two UTC days avoid partial or not-yet-published pageview totals.
    end = datetime.now(UTC).date() - timedelta(days=2)
    days = 90 if entry["prospectiveEligible"] else 30
    start = end - timedelta(days=days - 1)
    time.sleep(REQUEST_INTERVAL_SECONDS)
    points = WikimediaSeries(
        nonempty_text(entry, "project"), nonempty_text(entry, "article")
    ).fetch_daily(start, end)
    assert [point.date for point in points] == [start + timedelta(days=i) for i in range(days)]
    if entry["prospectiveEligible"]:
        daily_median = median(point.value for point in points)
        assert daily_median >= 500, f"{entry['id']}: 90-day median {daily_median} < 500 views"
