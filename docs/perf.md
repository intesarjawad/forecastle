# Pipeline performance

## Local model smoke test, 2026-11-12

Measured on macOS arm64, Python 3.12.15, CPU float32, using the locked
dependencies and model revisions in `pipeline/forecastle_pipeline/models.lock.json`.
Weights and configs were already downloaded and SHA-256 verified. These
are cached inference measurements with no downloads. The first load includes deferred model imports. This run shared the machine with other checks, so timings are indicative.

| Configuration   | Context | Load (s) | Predict 7 twice (s) | Predict 10 twice (s) | Total (s) |
| --------------- | ------- | -------- | ------------------- | -------------------- | --------- |
| chronos-2       | 28      | 18.768   | 1.823               | 0.333                | 20.924    |
| chronos-2-small | 28      | 0.100    | 0.391               | 0.277                | 0.768     |
| chronos-2-long  | 365     | 1.087    | 0.353               | 0.504                | 1.943     |

The test asserts finite Python floats, horizon shapes, ordered quantiles and
identical repeated predictions for both horizons. Its 120 s per-model gate
includes loading and all four predictions. Pytest reported `3 passed in 23.95s`,
including imports and test startup.

Reproduce with both Hugging Face cache variables set, so the hub weights
and Xet cache/logs stay inside the ignored repository cache:

```sh
export HF_HOME="$PWD/.cache/huggingface"
export HF_HUB_CACHE="$HF_HOME/hub"
UV_CACHE_DIR=.cache/uv HF_HUB_OFFLINE=1 uv run pytest -m model -s pipeline/tests/test_chronos2_smoke.py
```

Both weight hashes match the pinned values. The config hashes computed from the
pinned snapshots are committed alongside them in `models.lock.json`.
`load_forecaster(name)` reads the packaged lock and loads only the requested
configuration. It rejects fewer than 28 or 365 points respectively and uses
only that many trailing observations. Long context must be omitted by callers
when 365 observations are unavailable. For live rounds, predict 10 steps and
score the final seven as specified in ADR 0002.

The daily workflow runs the model smoke test after `fetch-model`; the ordinary
Python CI job excludes it. CI runner timings are not yet recorded here.
Full `make-puzzle` runtime is unmeasured.

## Card shell

The site uses three self-hosted Latin WOFF2 files: Shippori Mincho 400, 600 and 800.
The regular and display weights load after the playable sheet paints; other routes load them with their headings. All three
count toward the first-load budget, which `npm run lighthouse` measures below. The WebGL
bleed is a separate chunk initialized when fonts have settled and the browser is idle.
Installation metadata and icons follow the playable sheet paint. Live, data and scoring routes load their code only when opened. No font CDN or service worker is used. The manifest makes no offline promise. The page includes title, description and social-image metadata with absolute URLs.

`npm run lighthouse` builds the site, starts a strict local Vite preview on port
43873 (override with `FORECASTLE_PORT`), and runs Lighthouse's default mobile throttling with performance and
accessibility audits against a playable puzzle. By default it serves the recorded
New York puzzle from `site/tests/fixtures/2026-10-21` in the local build only,
and opens `#/p/2026-10-21`. The title font and current puzzle are preloaded. The font decodes while game code
arrives, and the first title paint precedes canvas rasterization. To measure a generated puzzle instead, pass
`--puzzle YYYY-MM-DD`. It runs three serial measurements with separate browser
launches, verifies the drawing's interactive mark, prints each LCP and the median, and retains raw reports under
`.cache/lighthouse/`. It replaces the generated playable measurement below, including failed budgets,
and exits non-zero if any run or the median has Performance below 95, Accessibility below 100, LCP at or
above 1500 ms, CLS at or above 0.02, or compressed assets at or above 220000 bytes.
The byte count sums gzip-compressed HTML, JS, CSS and font files in the entire
build, conservatively including any files that a first visit does not load.
Chrome must be available locally, optionally through `CHROME_PATH`.

`npx playwright test --project=mobile-chromium site/tests/e2e/performance.spec.ts`
runs a 3 s touch stroke and then the reveal with Chromium's CPU throttled 4x.
`PerformanceObserver` collects `longtask` entries during the stroke and both
`longtask` and `long-animation-frame` entries during the reveal; the test fails
on any entry over 50 ms. A Chromium trace of the run is attached to the test
result. Other projects skip it. Frames have intermittently exceeded the 50 ms threshold on a heavily loaded machine.

The daily chart overlays the measured column sheet. Below the 60em threshold,
three columns show the latest given week, the player and the AI; wider screens
show all six columns. The live charts retain their separate horizontal layout.
Resizes preserve an active gesture until it ends. All rendered pixel dimensions
and colours come from the root token table.

Regenerate the outlined favicon's PNG derivatives with
`node scripts/generate-icons.mjs`. This uses Sharp already installed by the
locked development dependencies; it adds no image service or font dependency.
The outputs are 180, 192 and 512 px squares.

To verify asset requests in a browser, run
`npx playwright test site/tests/e2e/origin.spec.ts`. The test intercepts requests
before navigation, blocks and records off-origin attempts, waits for font loading,
and fetches the manifest and its icons. Lighthouse needs a Chromium-based
browser; set `CHROME_PATH` when Chrome itself is not installed.

All specified text and overprint contrast pairs pass
the independent WCAG formula checks.

## Mobile shell measurement, 2026-11-06T01:54:56.424Z

Lighthouse 13.6.0, local Vite preview, default mobile throttling.

| Metric                                     |   Value | Budget   | Result |
| ------------------------------------------ | ------: | -------- | ------ |
| Performance                                |     100 | >= 95    | pass   |
| Accessibility                              |     100 | 100      | pass   |
| LCP (ms)                                   | 752.238 | < 1500   | pass   |
| CLS                                        |       0 | < 0.02   | pass   |
| Compressed HTML, JS, CSS and fonts (bytes) |   56930 | < 220000 | pass   |

## Mobile shell measurement, 2026-11-12T08:44:04.472Z

Lighthouse 13.6.0, local Vite preview, default mobile throttling.

| Metric                                     |             Value | Budget   | Result |
| ------------------------------------------ | ----------------: | -------- | ------ |
| Performance                                |               100 | >= 95    | pass   |
| Accessibility                              |               100 | 100      | pass   |
| LCP (ms)                                   | 760.3720000000001 | < 1500   | pass   |
| CLS                                        |                 0 | < 0.02   | pass   |
| Compressed HTML, JS, CSS and fonts (bytes) |            134179 | < 220000 | pass   |

## Playable puzzle measurement, 2026-11-12T18:02:53.564Z

Lighthouse 13.6.0, local Vite preview, default mobile simulated throttling.
Puzzle: 2026-10-21, Daily mean temperature, New York. 3 serial runs, separate browser launches.

Run 1: LCP 1436 ms, Performance 99, Accessibility 100, CLS 0.006966255101939747.

Run 2: LCP 1353.852 ms, Performance 100, Accessibility 100, CLS 0.006966255101939747.

Run 3: LCP 1390.916 ms, Performance 100, Accessibility 100, CLS 0.006966255101939747.

| Metric (median)                            |                Value | Budget   | Result |
| ------------------------------------------ | -------------------: | -------- | ------ |
| Performance                                |                  100 | >= 95    | pass   |
| Accessibility                              |                  100 | 100      | pass   |
| LCP (ms)                                   |             1390.916 | < 1500   | pass   |
| CLS                                        | 0.006966255101939747 | < 0.02   | pass   |
| Compressed HTML, JS, CSS and fonts (bytes) |               142674 | < 220000 | pass   |
