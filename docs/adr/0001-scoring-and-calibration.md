# 0001: Scoring and calibration

Status: Accepted.

## Context

Scores must be comparable across series with different units and scales.
The game and benchmark need identical TypeScript and Python calculations.

## Decision

Use mean absolute error (MAE) normalized by `typicalMove`: the maximum
of mean absolute visible-day changes, 1% of the visible range and machine
epsilon. Closeness is `round(100 * max(0, 1 - MAE / (k * typicalMove)))`.
Daily cells use one- and two-move error boundaries; coverage counts actual
values inside the player's band. Benchmark metrics also include scaled
Winkler (alpha 0.2) and mean pinball loss at 0.1, 0.5 and 0.9.

The calibration measured on 2026-11-05 is:

- k = 2.7037005241201317
- 95% percentile bootstrap interval: [2.497841531291008, 2.9903385449326803]
- 300 historical puzzles; 2,000 bootstrap resamples; seed 0 for both draws
  and bootstrap resampling, with independent generators.

Set k to twice the median flat-line MAE / typicalMove. The flat baseline
repeats the last of 28 visible values over the seven scored days. Golden
and parity fixtures carry their own k values and remain unchanged.

## Sampling and reproduction

Run `uv run python scripts/calibrate_k.py --run-date 2026-11-05` from the
repository root. Omitting the date uses the current UTC day. Source
observations are cached under `.cache/calibration/`; forecasts are computed
with the pinned `amazon/chronos-2` revision
`29ec3766d36d6f73f0696f85560a422f50e8498c` on CPU using only the 28 visible points.

Use the daily catalogue and sorted eligible candidates, alternate source
kinds, and exclude series from the preceding 30 puzzles. A NumPy generator
seeded with 0 draws each inclusive end-date offset, then its eligible series
index. End dates range from 2025-12-05 through 2026-10-24, twelve days before
the run date. Each window contains 28 visible and seven scored days. A fetch
failure stops calibration; no window is replaced based on either score.

## Measured Closeness

Quartiles use the rounded game scores at the calibrated k, with linear
quantile interpolation.

| Forecast             | First quartile | Median | Third quartile |
| -------------------- | -------------: | -----: | -------------: |
| Chronos-2, 28 points |           28.5 |     53 |             70 |
| Flat line            |             20 |     50 |             67 |

The opponent has strictly higher Closeness on 150 of 300 puzzles (50%).
Equal Closeness does not count as a win; band coverage is not used here.
These are historical descriptive results, not an estimate of human win
rates or contamination-free prospective performance. A flat line scores
about 50 on a typical puzzle, not on every puzzle. Any subsequent change
to k requires another decision record and a changelog entry.
