# 0008: Live-round analysis plan

Status: draft; not yet frozen or timestamped.

## Context

The comparison needs fixed metrics and inclusion rules before live data exists.
Overlapping rounds require a sensitivity analysis for public headline claims.

## Decision

The analysis plan below applies to live rounds. This record must be finalized,
committed, frozen and timestamped before the first live round opens.
Later additions apply only to rounds opened after a new ADR's date.

- Unit of analysis: one live chart. Rounds are clusters of 3 charts; every interval resamples whole rounds.
- Forecasters: chronos-2 (opponent), chronos-2 at cutoff, chronos-2-long, chronos-2-small, seasonal naive 7, flat, crowd median (per-day median of all submitted paths; band = per-day 10th to 90th percentile of paths), median human (per chart and per metric, the median of that metric over the chart's accepted submissions; for skill, the median submission's scaled MAE).
- Primary metric: scaled MAE (MAE / typicalMove). Secondary: Closeness, 80% coverage, scaled Winkler (alpha 0.2), scaled 3-quantile loss.
- Aggregation: arithmetic mean of scaled metrics with 95% percentile bootstrap intervals (10,000 resamples, seed 0); skill vs seasonal naive = 1 − geometric mean over charts of (forecaster scaled MAE / seasonal-naive scaled MAE), the convention fev uses.
- Crowd rows: a chart enters the crowd median and median human rows only if it received at least 10 accepted submissions by the cutoff; every table shows the number of charts in each row and the median submissions per chart. The rule is fixed here, so no chart is excluded after its result is known.
- Primary comparison: crowd median minus chronos-2 on scaled MAE, paired by chart; report mean difference with 95% bootstrap interval (resampling rounds) and an exact two-sided sign test over rounds, using each round's mean paired difference (charts in one week share news and season, so they are not independent).
- Inclusion: a chart is included once resolved; no chart is ever dropped after the fact. Submissions after the cutoff are rejected by the Worker, so none are filtered post hoc.
- Cadence: two rounds a week (Monday and Thursday open days). Each round is its own cluster. Consecutive rounds overlap by 4 scored days, so they are not fully independent (shared news, shared weekdays); no article appears in two rounds whose scored dates overlap, and the data card states the residual dependence.
- Overlap sensitivity (pre-registered here because Monday and Thursday rounds share scored days): the same bootstrap and sign test are also run over Monday rounds only, whose scored windows never overlap. Headline wording ("ahead" or "behind") requires both the all-rounds and the Monday-only interval to exclude zero with the same sign; otherwise "too close to call". `BENCHMARK.md` prints both lines.
- Minimum n for any headline: 6 resolved rounds (18 charts) in each of the two analyses, so the headline needs 6 Monday rounds, about 44 days after the first Monday round opens. Below 6 rounds an exact two-sided sign test cannot reach p < 0.05 (its smallest p with 5 rounds is 2/32 = 0.0625) and a percentile bootstrap over so few clusters has too few distinct resamples to mean anything; below that the README shows the table with "early, n = … charts in … rounds" and no ahead or behind wording.
- Known limit, stated in the data card: inputs are public, so a player could run the model themselves; the game only guarantees the opponent's forecast is not served before the cutoff. Entries are "players", not "unaided humans".
- Every addition (new forecaster, new metric) is a new ADR that applies only to rounds opened after its date.
