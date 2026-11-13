# Contributing

Read the [engineering standards](docs/engineering-standards.md)
and [code of conduct](CODE_OF_CONDUCT.md) before contributing.

Use the versions and setup commands in [README.md](README.md). Run the complete local check:

```sh
npm run check && npm run check:py
```

The pre-commit hook checks formatting, lint and types. Tests run in the complete check above.
Use focused changes and conventional commit messages. Include the relevant test output in a pull request.

After configuring the Worker and its D1 database, deploy the current commit manually:

```sh
cd worker && npx wrangler deploy --var GIT_SHA:$(git rev-parse HEAD)
```

Series proposals need a source URL, licence evidence, publication lag and a fixture. Series must be
apolitical and must not concern living people. Forecaster proposals need a model identifier,
licence, CPU runtime and golden output. Scoring and the analysis plan are frozen; changes require an ADR and changelog entry.
