# 0005: Non-uniform time axis

Status: accepted, 2026-11-05.

## Context

Drawing seven future points needs more horizontal space than a uniform
35-day axis would provide on a phone.

## Decision

Use 65% of daily plot width for 28 visible days and 35% for seven hidden
days. Live charts allocate 58% to visible history, 10% to a hatched gap
labelled "not published yet", and 32% to scored days. Show the boundary and
relative-day ticks; show actual dates for live rounds. The axis intentionally
uses different horizontal scales for these segments. The visual style is
recorded in [the design direction](../design/README.md), not here.
