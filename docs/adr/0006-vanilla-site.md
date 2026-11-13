# 0006: Vanilla TypeScript site

Status: accepted, 2026-11-05.

## Context

The interaction is a single-screen drawing game with static puzzle files.

## Decision

Use Vite, strict TypeScript, vanilla DOM and SVG, without a framework.
Keep scoring, sampling, share text, streaks and date logic in the pure core.
DOM, fetch, storage and clock access belong at the edges. Hash routes and
Vite's relative base support project Pages paths and later renaming.
