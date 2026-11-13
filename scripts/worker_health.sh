#!/usr/bin/env bash
# WORKER_URL overrides data/game.json; set but empty tests the skip for an undeployed Worker.
set -euo pipefail
url=${WORKER_URL-$(jq -r .workerUrl data/game.json)}
if [ -z "$url" ]; then echo "::notice::No Worker deployed yet (workerUrl empty); health check skipped"; exit 0; fi
# curl retries 3 times on no connection, timeouts and 5xx, waiting 1, 2, 4 s.
out=$(curl -s --retry 3 --retry-all-errors --max-time 10 -w '\n%{http_code}' "$url/v1/version") || out=$'\n000'
code=${out##*$'\n'}
if grep -Eqi "error( code:)? 1027" <<<"$out"; then
  echo "::error::Worker daily request quota (100,000, Workers Free) is spent; entries fail until 00:00 UTC, then this clears by itself. Next: before the next expected busy day, add a dated entry such as {\"from\": \"$(date -u +%F)\", \"to\": \"$(date -u +%F)\", \"rate\": 0.25} to submitRateSchedule in data/game.json"; exit 1
fi
case $code in
  200) sha=$(jq -r .sha <<<"${out%$'\n'*}") ;;
  503) echo "::error::Worker at $url answers but its D1 query failed (/v1/version 503 after 3 retries); live entries are not being stored. Next: cd worker && npx wrangler d1 execute submissions --remote --command 'SELECT 1 FROM submissions LIMIT 1'. If a table is missing: npx wrangler d1 execute submissions --remote --file schema.sql. If the D1 daily limit is spent, it resets at 00:00 UTC. Then re-run this workflow"; exit 1 ;;
  *) echo "::error::Worker unreachable at $url/v1/version (HTTP $code after 3 retries); live entries are being lost. Next: cd worker && npx wrangler deploy --var GIT_SHA:\$(git rev-parse HEAD) from main (CONTRIBUTING), check curl $url/v1/version prints a sha, then re-run this workflow (live.yml before the cutoff: gh workflow run live.yml -f command=open -f open_day=<the Monday or Thursday>)"; exit 1 ;;
esac
last=$(git log -1 --format=%H -- worker/ 2>/dev/null || true)
if [ -z "$sha" ] || ! git merge-base --is-ancestor "$last" "$sha" 2>/dev/null; then
  echo "::warning::Worker is behind main; run the deploy command in CONTRIBUTING"
fi
