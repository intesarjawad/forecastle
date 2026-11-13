# Validation

How the local setup and its checks were verified on 2026-11-05.

## Environment

Where the user-level caches are not writable, point the tools at repository-local
ones:

```sh
export npm_config_cache=.cache/npm
export UV_CACHE_DIR=.cache/uv
export WRANGLER_LOG_PATH=.cache/wrangler/logs
```

Without these, npm and uv can fail with EPERM when writing their caches.

## Pins

`npm outdated --workspaces --include-workspace-root` exits 1 with only:

```text
Package                         Current        Wanted        Latest
@cloudflare/workers-types  5.20260822.1  5.20260822.1  5.20261104.1
vitest                           4.1.12        4.1.12         5.1.0
```

Both exceptions and their compatibility reasons are in
[ADR 0007](adr/0007-pins-and-tooling.md), together with the PyPI check of the
exact Python pins. `uv lock --upgrade --dry-run` reported no lockfile changes.

## Pre-commit hook

`.githooks/pre-commit` checks staged files with Biome, both TypeScript projects,
and Python formatting, lint and strict types. `npx --no-install` requires the
installed tools and avoids fetching a missing binary during a commit. `npm run
prepare` points `core.hooksPath` at `.githooks`.

To check that the hook rejects bad input without touching this repository, I
initialized a scratch repository, set its `core.hooksPath` to `.githooks`,
copied the hook and Biome config, and linked the installed `node_modules`. I
staged this error:

```ts
export const broken: any = 1;
```

`git commit -m 'test: reject staged lint error'` exited 1 with the
`noExplicitAny` diagnostic, and `HEAD` did not exist afterwards:

```text
Found 1 error.
Some errors were emitted while running checks.
git commit exit: 1; Biome noExplicitAny confirmed; no commit created
```

## Complete check

`npm run check && npm run check:py` runs Biome, both TypeScript projects, the
site and Worker suites, Python formatting, lint, strict types and the offline
Python tests. Tests marked `model` or `slow` are excluded; see
[perf.md](perf.md) and [catalogue.md](catalogue.md) for those.

`npm run build` writes the static site to `site/dist`.
