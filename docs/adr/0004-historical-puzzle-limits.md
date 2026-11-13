# 0004: Historical puzzle limits

Status: accepted, 2026-11-05.

## Context

Historical windows cannot establish prospective forecasting performance
or prove the absence of training contamination.

## Decision

Draw historical windows entirely after the model weights' publication:
the first possible last scored day is 2025-12-05, so all 35 observations
start after 2025-11-01. The latest scored end is workflow UTC date minus
12 days, beyond the planned ERA5 lag. Label historical puzzles post-release;
make no contamination-free claim. Head-to-head evidence comes from live
rounds whose scored dates follow the entry cutoff.
