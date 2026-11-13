# 0011: Puzzle window shape and date-derived seeds

Status: accepted, 2026-11-05.

## Context

A six-argument constructor conflicts with the ruff rules PLR0913 and PLR0917.
The date-seeded standard-library random draws conflict with S311.

## Decision

Use a frozen `WindowShape` dataclass with `horizon=7`, `visible=28` and
`gap_days=0`. Require it as the fourth argument of
`build_puzzle(series_values, dates, end_index, shape)`. The lint bar takes
precedence over a flat six-argument signature.

For historical end dates, daily series and live articles, use NumPy
`default_rng` seeded by
`int.from_bytes(sha256(puzzle_date_string.encode()).digest()[:8], 'big')`.
Live rounds use the opening day's ISO date string. SHA-256 makes seed
conversion stable across interpreter versions and dependent solely on the
date string. NumPy remains pinned; fixed draw fixtures detect sequence
changes when upgrading it. These draws replace the earlier sequences.

Candidate sorting, inclusive historical bounds, recent-series exclusions,
kind alternation and overlapping-round exclusions remain in force. No lint
suppression or dependency change is needed.
