# Series adapters

The adapters fetch daily observations from Open-Meteo (ERA5) and Wikimedia
pageviews with the standard library and no API keys. The fixtures were recorded
on 2026-11-05 with three sequential requests. The JSON fixtures preserve the source responses, with whitespace formatting only.
Offline tests block HTTP requests by default.

## Fixture provenance

All files below are in `pipeline/tests/fixtures/`.

- `open_meteo_oslo.json`: [ERA5 Oslo daily mean temperatures, October 1 to 14](https://archive-api.open-meteo.com/v1/archive?latitude=59.91&longitude=10.75&start_date=2026-10-01&end_date=2026-10-14&daily=temperature_2m_mean&timezone=auto&models=era5).
- `open_meteo_oslo_trailing_null.json`: [ERA5 Oslo daily mean temperatures, October 25 to November 4](https://archive-api.open-meteo.com/v1/archive?latitude=59.91&longitude=10.75&start_date=2026-10-25&end_date=2026-11-04&daily=temperature_2m_mean&timezone=auto&models=era5).
- `wikimedia_pumpkin.json`: [English Wikipedia Pumpkin daily user pageviews, October 1 to 14](https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/Pumpkin/daily/2026100100/2026101400).
  Wikimedia pageview data is CC0.

## Source behaviour

ERA5 returned temperatures through October 30, then five trailing `null` values
from October 31 to November 4. The first missing date is October 31. A successful
HTTP response and a full date array therefore do not guarantee available data.
The probe uses a 12-day margin, matching the historical-fetch margin in [ADR 0004](adr/0004-historical-puzzle-limits.md).

Open-Meteo snapped the requested latitude 59.91 to the ERA5 grid latitude 60.0;
the returned longitude was 10.75. It reported `Europe/Oslo` and a UTC offset of
3600 seconds. Adapters retain the API's calendar dates without converting them.

Wikimedia returned all 14 inclusive dates with string timestamps ending in `00`.
The adapter replaces spaces with underscores and percent-encodes the full title
as one path segment, including slashes and non-ASCII characters.

`DailyPoint` is a frozen dataclass with `date: date` and `value: float`. Both
adapters return chronological inclusive ranges and reject missing days,
duplicates and invalid numeric observations. Zero is a valid observation.

`series/http.py` uses the placeholder
`https://example.invalid/forecastle` in the versioned User-Agent. Replace it
once the public repository exists. Both live APIs accepted this User-Agent.

`probe` takes any series id from `data/catalogue.json` and prints the 14 days
ending 12 days before today (UTC), the newest a daily puzzle can use. When
`make-puzzle` cannot read a series, its error names the `probe` command for it.
If an Open-Meteo city still fails after one retry, that day's puzzle is drawn
from the Wikimedia series instead.
The series catalogue is described in [catalogue.md](catalogue.md).

## Probe

`UV_CACHE_DIR=.cache/uv uv run forecastle-pipeline probe meteo-oslo-tmean`
prints 14 lines. On 2026-11-05 they covered October 11 to 24, inclusive, and
ended with:

```text
2026-10-22 11.5
2026-10-23 9.3
2026-10-24 8.9
```

Run the adapter tests with
`UV_CACHE_DIR=.cache/uv uv run pytest pipeline/tests/test_series_fixtures.py`.
They are offline; HTTP requests are blocked by default.
