# 0003: Answer separation and sealed live forecasts

Status: accepted, 2026-11-05.

## Context

A static daily site cannot enforce answer secrecy. Serving the opponent's
live forecast during entry would let players copy it into the comparison.

## Decision

Serve daily answers in a separate static `answer.json`, fetched after
lock. Daily play uses an honour system. Live entries go through the Worker,
which enforces the cutoff and rejects duplicate puzzle/client pairs.

At live open, publish only the opponent forecast's SHA-256 commitment and
OpenTimestamps proof. Keep encrypted plaintext under `sealed/`, outside the
site deployment; omit `ai` from the public live puzzle. After cutoff,
decrypt and publish the forecast, checking its bytes against the commitment.
Publish actuals at resolution. Public model inputs still allow players to
run the model themselves; entries are players, with no claim of unaided play.
