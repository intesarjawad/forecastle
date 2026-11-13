# Architecture

This document describes how the system fits together. The site, the Worker,
the pipeline and the GitHub Actions workflows in the diagram (`daily.yml`,
`live.yml`, `pages.yml`, in `.github/workflows/`) are in the repository.
`pages.yml` deploys on pushes to `main`, completed daily and live data workflows,
and manual dispatch. Repository Pages configuration and credentials are required.

```
                GitHub Actions (cron, CPU only)
  ┌──────────────────────────────────────────────────────────────┐
  │ daily.yml 00:10 UTC              live.yml                    │
  │  make-puzzle (date +2)            Mon,Thu 00:05 open round   │
  │   ├ series adapter ─► Open-Meteo   Wed,Sat 00:05 close round │
  │   │   (models=era5) / Wikimedia    Wed,Sat 06/12/18 resolve  │
  │   ├ forecasters (chronos-2 CPU,     ├ forecast + sha256 + .ots│
  │   │   small, long, baselines)       └ export ─► benchmark/   │
  │   └ site/public/puzzles/<date>/     BENCHMARK.md, HF mirror  │
  │  then pushes; pages.yml deploys on the push                  │
  └───────────────┬──────────────────────────────────────────────┘
                  │ push to main as BOT_IDENTITY (token or app, admin bypass) → pages.yml
                  ▼
   GitHub Pages (static)                 Cloudflare Worker (free)
   index.html, app.js                    POST /v1/submit (skipped if opted out)
   puzzles/<date>/puzzle.json ◄─fetch    GET  /v1/stats/:id, /v1/version (D1 check)
   puzzles/<date>/answer.json ◄─(after   GET  /v1/export/:id (bearer)
   live/<id>/…, puzzles/index.json  lock)   │ D1: submissions
                  ▲                         │ rate-limit binding
            Browser (vanilla TS + SVG)      ▼
            draw → band → lock → score (TS) → share
```

Pure core, thin shell: `site/src/core/` (scoring, sampling, share text, streaks, dates) and `pipeline/forecastle_pipeline/core/` (scoring, puzzle construction, live-round calendar, benchmark statistics) have no I/O. Adapters (HTTP, model, D1, DOM, filesystem) live at the edges.

## Decisions

The numbered records in [adr/](adr/) hold the design decisions. Record 0008,
the live-round analysis plan, is still a draft: it is not frozen or timestamped.
Record 0007 covers dependency pins and tooling compatibility.

## Local checks

Run `npm run check && npm run check:py` for the complete local gate.
`npm run prepare` installs `.githooks/pre-commit` through `core.hooksPath`.
The executable hook checks staged files with Biome, both TypeScript projects,
and Python formatting, lint and strict types. It uses installed npm binaries;
tests run through the complete gate rather than on every commit.
See [the validation notes](validation.md).

`ci.yml` runs the same gate in CI. It and main-branch protection need a remote
repository, which does not exist yet.
