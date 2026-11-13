# Forecastle live rounds: data card

Forecastle asks players to draw the next seven days of a real daily chart before a forecasting
model's forecast is revealed. This dataset is the set of charts from the live rounds: the history
every entrant saw and the values that followed. It lets anyone score another forecaster on exactly
the charts the players and the opponent faced.

The scores, intervals and headline comparison are in [BENCHMARK.md](../BENCHMARK.md). The analysis
plan is [ADR 0008](../docs/adr/0008-live-round-analysis.md). This card describes the data only.

## What is in it

- One item per live chart. Each round has three charts, and two rounds open each week (Monday and
  Thursday).
- Every chart is a Wikipedia article's daily page views (Wikimedia pageviews, CC0). No other
  source is used for live rounds.
- Only resolved rounds are published, after all seven scored days have been observed. A resolved
  round never changes.
- The synthetic fixture used by the tests is never exported.
- Individual submissions are not part of the mirror. The repository's resolved round files hold
  anonymous per-submission scores and the crowd's per-day quantiles, with no client identifiers
  (see [ADR 0010](../docs/adr/0010-privacy-and-free-tier-budget.md)).

## Schema

The Hugging Face mirror is a `fev` dataset with one config, `live`, stored in
`live/data.parquet`. The layout follows the `fev` 0.10 dataset format: one row per time series,
sequence columns of equal length, a string `id` and a `timestamp` column of timestamps.

| Column | Type | Meaning |
| --- | --- | --- |
| `id` | string | Chart id, `<round id>-<1..3>`, for example `live-YYYY-MM-DD-1`. Unique. |
| `round_id` | string | Round id, `live-` plus the opening day. Static column. |
| `series_id` | string | Catalogue id of the source series. Static column. |
| `timestamp` | list of timestamp[ms] | 38 consecutive daily timestamps (UTC dates at midnight). |
| `target` | list of float64 | Page views per day, aligned with `timestamp`. |

Each `target` has three parts, in order:

1. 28 visible days. This is the history every entrant and the opponent saw. It ends two days
   before the opening day O, at O - 2.
2. Three gap days, O - 1, O and O + 1, stored as NaN. They are never scored and are not archived.
3. Seven scored days, O + 2 to O + 8.

`tasks.yaml` in the mirror is the `fev` task, loadable with `fev.Benchmark.from_yaml`:

- `horizon: 10`, `num_windows: 1`, `initial_cutoff: -10`, so the past is the 28 visible days and
  the future is the three gap days followed by the seven scored days. The opponent also forecasts
  ten steps and the last seven are scored ([ADR 0009](../docs/adr/0009-live-calendar-and-gaps.md)).
- `seasonality: 7`, `eval_metric: MASE`, `extra_metrics: [SQL]`, `quantile_levels: [0.1, 0.5, 0.9]`.
- `fev` ignores NaN ground truth, so the gap days do not count towards any score.

`fev` MASE scales each chart by its in-sample seasonal error. The game and `BENCHMARK.md` scale by
the chart's typical daily move, so the two sets of numbers are not comparable. Forecasters
compared through this task must be compared only with each other.

Run `uv run --group bench python scripts/check_fev_task.py benchmark/` to export the rounds,
load them as a `fev` task and print the scores of the seasonal-naive-7 baseline. While no live
round has resolved, it checks the synthetic fixture and says so.

## How the rounds are made

- A round opens on a Monday or Thursday at 00:05 UTC with three articles drawn from the eligible
  catalogue. An article is not drawn again while its earlier round's scored dates overlap the new
  round's.
- Entry closes at O + 1 23:59:59 UTC, before the first scored day. The Worker rejects later
  submissions.
- The opponent's forecast is committed (hashed, with an OpenTimestamps proof) when the round
  opens and published after the cutoff.
- Rounds resolve at O + 9 06:00 UTC, retrying when source data is missing.

## Known biases

Read these before drawing conclusions from the data or from any comparison built on it.

- **Interval scores favour models.** A player's band has one constant half-width for all seven
  days. A model's band widens with the forecast day. Winkler, quantile loss and coverage are not
  like-for-like and favour the models. The primary comparison uses scaled MAE, which does not use
  the bands.
- **Players, not unaided humans.** The inputs are public, so a player could run a model or
  consult the source data themselves. The game guarantees only that the opponent's forecast is not
  served before the cutoff. Entries are "players", and the crowd rows are the crowd of players.
- **Self-selection.** Players choose what to play and may enter only the charts they find easy.
  The players who enter a chart are not a random sample of people, and the number of entries
  differs between charts. A chart enters the crowd rows only with at least 10 accepted
  submissions.
- **Gap days.** A player who enters late has seen up to three more days of public data than the
  opponent, whose history ends at O - 2. Later entrants therefore have more information than the
  opponent row. The at-cutoff row (chronos-2 given the history through O) exists to show how much
  that extra information is worth.
- **Overlapping rounds.** Consecutive Monday and Thursday rounds share four scored days, so
  rounds are not fully independent clusters. Charts within a round share news and season. The
  analysis resamples whole rounds, and a Monday-only sensitivity analysis uses rounds whose scored
  windows never overlap.
- **One source.** Every chart is a Wikipedia article's views. Page views have weekly seasonality
  and sudden spikes that other kinds of series may lack, so results may not carry over to them.

## Licence

The published data is CC BY 4.0 ([DATA_LICENSE](../DATA_LICENSE)). Wikimedia pageview data is CC0
and attribution is requested but not required by the source; this dataset's values are derived
from it. Code is MIT. See [NOTICE](../NOTICE) for upstream terms.

## Citation

See [CITATION.cff](../CITATION.cff).

## Maintenance

The mirror is rewritten from the resolved round files after each resolution run, so it grows by
up to three items per resolved round and existing items do not change. The repository is the source
of truth; the mirror is a convenience copy.
