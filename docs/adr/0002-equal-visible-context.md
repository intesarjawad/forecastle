# 0002: Equal visible context

Status: accepted, 2026-11-05.

## Context

A model with additional history would not face the same puzzle as a player.

## Decision

Give the game opponent exactly the same 28 visible observations as the
player. Daily puzzles score the next seven days. Live rounds predict ten
steps from the visible end and score the last seven, skipping the gap.
Long-context, small-model, at-cutoff and baseline forecasts are benchmark
rows only; they do not replace the opponent row.
