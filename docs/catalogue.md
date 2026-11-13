# Catalogue

## Selection and review

`data/catalogue.json` contains 44 English Wikipedia articles and 16 Open-Meteo
cities. The Wikimedia theme counts are sky 6, food 6, seasons 6, nature 6,
games 5, sport 5, landmarks 5 and science 5. Weather is the ninth schema slug,
used only for the 16 cities. Cities cover both hemispheres and equatorial,
maritime, continental, desert, monsoon and high-elevation conditions.

Every article title and description was reviewed for the exclusions: no living-person subjects, politics, finance or medical topics. Sport entries
are events rather than people. The representative title deny list in
`pipeline/tests/test_catalogue.py` guards known exclusions; it is not a classifier.
Future additions still need the same manual review.

## Live findings

Validated on 2026-11-05 through the committed Wikimedia adapter, using daily
user pageviews across all access methods on `en.wikipedia`. The 90-day candidate
window was 2026-08-06 through 2026-11-03, inclusive. A two-day UTC margin avoids
partial or unpublished daily totals. Requests were sequential with a one-second
pause before each request. No credentials or paid services were used.

The initial sweep identified two unsuitable title spellings: `Perseid meteor
shower` had missing dates and `Migration of birds` returned HTTP 404. Replacing
them with `Perseids` and `Bird migration` respectively returned all 90 days.
Use exact article titles: these alternate spellings did not provide complete
series in this sweep.

Seven articles remain historical-only because their measured trailing 90-day
medians were below 500 daily views:

| Article          | Median daily views |
| ---------------- | -----------------: |
| Meteor shower    |              239.5 |
| Perseids         |                190 |
| Winter solstice  |              463.5 |
| Summer solstice  |              359.5 |
| Bird migration   |              201.5 |
| Crossword        |                253 |
| Fibonacci number |              381.5 |

The other 37 articles are marked `prospectiveEligible: true`. These flags record
curation eligibility, not a permanent guarantee: round opening must recheck the
trailing 90-day median and the visible window. All city
entries have `prospectiveEligible: false`.

## Checks

The offline tests enforce exact source counts, theme coverage, unique ids and
source identities, non-empty descriptions, field shapes, coordinate ranges,
units, hemisphere coverage and the title deny list. The slow tests require 30
complete consecutive days for every historical-only article, and 90 complete
days (including the last 30) plus a median of at least 500 for live candidates.
They use real adapter requests and do not substitute fixture data or retry away
source failures.

Reproduce the dated medians above, including all 90 observations for each
historical-only article:

```sh
uv run python scripts/catalogue_report.py --end 2026-11-03
```

`--end` selects an inclusive calendar date. Requests use the committed adapter,
which rejects missing, duplicate or invalid daily observations before reporting.

Run the rolling live catalogue check explicitly before changing eligibility.
The daily workflow generates puzzles; it does not run this network test:

```sh
uv run pytest -m slow pipeline/tests/test_catalogue.py
```

Run the complete acceptance suite with:

```sh
uv run pytest pipeline/tests/test_catalogue.py
```

The normal `npm run check:py` command excludes `slow` tests and stays offline.
