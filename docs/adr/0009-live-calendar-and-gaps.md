# 0009: Live calendar and gap days

Status: accepted, 2026-11-05.

## Context

Live entries must close before scored observations occur, while allowing
source publication lag. Entrants may see newer public data than the opponent.

## Decision

Open rounds on Monday and Thursday (day O) at 00:05 UTC. Visible history
ends O - 2. The unscored gap is O - 1, O and O + 1; entry closes at
O + 1 23:59:59 UTC. Score O + 2 through O + 8 and first resolve at
O + 9 06:00 UTC, retrying at 12:00 and 18:00 when data is missing.

The opponent receives 28 points and forecasts ten steps, last seven scored.
The at-cutoff benchmark row receives 28 points through O and forecasts eight
steps, last seven scored. Reject other opening weekdays and never score a
gap day. Exclude articles already in rounds with overlapping scored dates.
Monday and Thursday windows still overlap by four days; ADR 0008 records
the sensitivity analysis.
