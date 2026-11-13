# 0007: Dependency pins and tooling compatibility

Status: accepted, 2026-11-05.

## Context

Exact pins keep the checks reproducible, but a few latest releases conflict
with each other or with the Cloudflare test runtime. This record lists the
deliberate deviations from "newest everything" and the reason for each.

## Decision

### Datasets

Use `datasets==4.8.5` with `fev>=0.10.0` in the optional `bench` dependency
group. `datasets` 5.1.0 is the newest release, but fev 0.10.0 is the latest fev
and requires `datasets<5.0,>=2.15` (verified on PyPI on 2026-11-05). 4.8.5 is
the latest 4.x release.

### Test tooling

TypeScript stays at 7.0.2 with the strict options in `tsconfig.base.json`.
Both workspaces use Vitest 5.1.0. The Worker uses
`@cloudflare/vitest-plugin` 1.8.0 with the `cloudflareTest` Vite plugin, local
bindings and D1. It replaced the deprecated `@cloudflare/vitest-pool-workers`
runtime; no split Vitest versions remain.

`typings/chronos/__init__.pyi` declares only the `Chronos2Pipeline` loading and
quantile prediction calls the pipeline uses, because chronos-forecasting 2.3.2
does not ship `py.typed`.

### Worker runtime

`worker/wrangler.toml` sets `compatibility_date = "2026-08-22"`.
The date is an explicit application compatibility pin, independent of the test
runtime's newest supported date. `@cloudflare/workers-types` is pinned to
`5.20261112.1` alongside Wrangler 4.160.1 in `worker/package.json`.

`worker/tsconfig.json` sets `skipLibCheck: true`, for the Worker only. Without
it `tsc -p worker` reports errors that all sit in dependency declarations:
The Node declarations used by the test tooling and the Cloudflare runtime
declarations overlap. Strict checking of Worker source, tests and
`vitest.config.ts` stays on. The site and shared configurations are unchanged.

## Consequences

The npm lockfile records the shared Vitest version, current Cloudflare plugin
and matching runtime dependencies. The optional dataset group retains the fev
compatibility constraint above. Vite is pinned to 8.3.6.

Model revisions and checksums are immutable inputs recorded in
`pipeline/forecastle_pipeline/models.lock.json`.

The Biome configuration uses the `recommended` preset. The removed pool
package and its compatibility ceiling no longer constrain the test runner.

Sources: [Vitest setup](https://developers.cloudflare.com/workers/testing/vitest-integration/get-started/)
and the committed npm and uv lockfiles.
