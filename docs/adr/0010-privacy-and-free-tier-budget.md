# 0010: Privacy and free-tier budget

Status: accepted, 2026-11-05.

## Context

Crowd statistics require submissions, while the free Worker and D1 quotas
must leave capacity for live entries and avoid cross-puzzle tracking.

## Decision

Store a puzzle-specific client id, seven path values, band half-width,
time to lock, creation time and Worker-generated sample key. Derive the id
from a browser-only secret and puzzle id using HMAC-SHA256; never send the
secret, so the id changes with every puzzle and two plays cannot be linked.
No IP address is stored: the Worker reads the connecting address only as the
rate-limit key. The crowd switch at `#/data` disables submission; a daily play
with the switch off requests statistics only, naming just the puzzle id.

Sharing sends no request. An earlier plan had the site ping the Worker on
share to count shares; I removed it, so that sharing sends nothing and the
privacy notice can say so plainly. There is no share ping.

Export requires a bearer token and omits client ids. The Worker has no expiry
job: submissions stay until the operator deletes them, and browser data stays
until the player clears it. `docs/privacy.md` is the public notice. The site
links to it from every page footer and from `#/data`; it must be updated in
the same change as any field the lock sends or the Worker stores.

I budget D1 at 5,000,000 rows read and 100,000 rows written per day.
Four row writes per submit give about 25,000 submits. Cap stored daily
submissions at 5,000 per puzzle: up to three daily ids cost at most 60,000
writes, leaving room for live entries, which have no per-chart cap. Later
daily submits return 202 and score locally. Cache stats for 300 seconds and
query a random sample with `ORDER BY sample_key LIMIT 1000`, plus a stored
count. The benchmark uses full exports, not sampled stats.

I budget Workers at 100,000 requests daily. Reserve 10,000 for live
entries, health checks and exports, leaving 90,000 daily plays at rate 1.
A daily play makes at most one request: submit returns stats, or an opted-out
play gets stats. Revisits use cached play records. Resolved live crowd paths
are static; pending charts have no crowd line. At launch, a dated daily
sampling rate of 0.25 covers 360,000 plays with 90,000 requests; live POSTs
are never sampled. The schedule returns to 1 after its date range.

These are planning limits and arithmetic, not measured capacity or a fresh
service-limit verification. The free-plan rate-limit binding still needs
verifying; record any fallback here.
