# Benchmark

## Live rounds

Resolved: 0 charts in 0 rounds.

| Forecaster             | n charts | Median submissions / chart | Scaled MAE  | Closeness   | 80% coverage | Scaled Winkler | Scaled 3-quantile loss | Skill vs seasonal naive |
| ---------------------- | -------- | -------------------------- | ----------- | ----------- | ------------ | -------------- | ---------------------- | ----------------------- |
| chronos-2 (opponent)   | 0        | no charts scored yet       | unavailable | unavailable | unavailable  | unavailable    | unavailable            | unavailable             |
| chronos-2 at cutoff    | 0        | no charts scored yet       | unavailable | unavailable | unavailable  | unavailable    | unavailable            | unavailable             |
| chronos-2 (365 points) | 0        | no charts scored yet       | unavailable | unavailable | unavailable  | unavailable    | unavailable            | unavailable             |
| chronos-2-small        | 0        | no charts scored yet       | unavailable | unavailable | unavailable  | unavailable    | unavailable            | unavailable             |
| Seasonal naive 7       | 0        | no charts scored yet       | unavailable | unavailable | unavailable  | unavailable    | unavailable            | unavailable             |
| Flat line              | 0        | no charts scored yet       | unavailable | unavailable | unavailable  | unavailable    | unavailable            | unavailable             |
| Crowd median           | 0        | no charts scored yet       | unavailable | unavailable | unavailable  | unavailable    | unavailable            | unavailable             |
| Median human (players) | 0        | no charts scored yet       | unavailable | unavailable | unavailable  | unavailable    | unavailable            | unavailable             |

No paired rounds scored yet (n = 0 charts in 0 rounds; Monday-only n = 0 charts in 0 rounds).

All rounds: crowd median minus chronos-2 scaled MAE = unavailable; exact two-sided sign-test p = unavailable; n = 0 paired charts in 0 contributing rounds.

Monday-only sensitivity: crowd median minus chronos-2 scaled MAE = unavailable; exact two-sided sign-test p = unavailable; n = 0 paired charts in 0 contributing rounds.

Arithmetic chart means carry 95% percentile bootstrap intervals, resampling whole contributing rounds (10,000 resamples, seed 0). Charts have equal weight, including when crowd eligibility varies by round. Crowd median and median human rows require at least 10 accepted submissions per chart. Median human aggregates each submission metric separately. Skill is 1 minus the geometric mean of chart scaled-MAE ratios against seasonal naive. Skill is unavailable if any included chart has zero seasonal-naive MAE; no chart is removed for this reason.

The primary difference is crowd median minus opponent scaled MAE; negative values favour the crowd. Sign tests use round mean differences, omitting exact ties. Comparison counts include only rounds with eligible pairs. Headline claims require at least 6 contributing rounds in both analyses and intervals excluding zero with the same sign.

Consecutive Monday and Thursday rounds share scored days and are not fully independent. Monday-only scored windows do not overlap. Inputs are public; entries are players, and self-selection and access to later information limit the comparison. Synthetic fixtures are excluded from live totals.

Analysis rules: [ADR 0008](docs/adr/0008-live-round-analysis.md).
