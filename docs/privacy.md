# Privacy

Forecastle has no accounts, no cookies and no analytics. This page lists what
is stored, where, for how long, and exactly what leaves your browser.

## Stored in your browser

Five `localStorage` entries, all under this site's origin:

| Key                         | Holds                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `forecastle.v1.plays`       | Your saved daily plays, in the schema below.                                                                                                           |
| `forecastle.v1.secret`      | A random 32-byte secret, as 64 hex characters. It is created the first time you lock a play that is sent to the crowd line. It is never sent anywhere. |
| `forecastle.v1.crowdOptOut` | `true` when you have turned the crowd line off. Absent otherwise.                                                                                      |
| `forecastle:read-hint`      | Records that you have seen the reading hint.                                                                                                           |
| `forecastle.v1.live`        | Your locked live-round entries, one per chart, in the schema below. They are part of the history download.                                             |

These stay until you clear this site's data in your browser, or delete them
from the browser's storage panel. Nothing expires them. Custom puzzles opened
from a link are not saved to your history.

You can read, download and restore your plays and live entries at `#/data`.
Restoring adds records from a file and never overwrites a play or an entry
already on the device.

## What a lock sends

When you lock a daily puzzle and the crowd line is on, the site sends one
`POST` to the Worker with:

- `puzzleId`: the puzzle's date, for example `2026-11-20`.
- `clientId`: a UUID derived as HMAC-SHA256 of the puzzle id, keyed with your
  local secret, and cut to 16 bytes. The id changes with every puzzle, so two
  of your plays cannot be linked to each other from what is stored. Without
  the secret nobody can compute it. The Worker uses it only to refuse a second
  entry for the same puzzle.
- `path`: your seven drawn values.
- `halfWidth`: the half-width of your band.
- `msToLock`: the milliseconds between your first stroke and your lock,
  capped at one hour.

The Worker adds a creation time and a random sample key, and stores these
fields in D1. It never receives your name or your secret. The response is
the crowd statistics for that puzzle.

On busy days the site shows the crowd line to a share of players only. A play
that is sampled out sends no play or statistics request when locked.

Locking a live-round chart sends the same `POST`, with the chart id (for
example `live-2026-11-09-1`) as `puzzleId`. It is always sent, even on busy
days, and the response carries no crowd statistics: those stay hidden until
the round resolves and then come from the site's static files. With the crowd
line off, a live entry stays on your device and is not counted. An entry that
did not arrive is sent again the next time the live page opens before the
cutoff; if the Worker already holds it, that counts as sent.

### Turning it off

Open `#/data` and clear "Add my plays to the crowd line". Your choice is
saved in `forecastle.v1.crowdOptOut`. After that a lock sends no play. For a
daily puzzle it still requests the crowd statistics with a `GET` that names
only the puzzle id, so the crowd line can appear. Entries already sent are not
removed by turning the switch off.

## What the server keeps

For each submission: puzzle id, the derived client id, the seven path values,
band half-width, time to lock, creation time and sample key. No IP address is
stored. The Worker reads the connecting address only as the key for a rate
limit of 60 submissions a minute, and does not write it to the database. Your
network address is still visible to the hosts that carry the traffic: GitHub
Pages for the static site and Cloudflare for the Worker, under their own
policies.

The Worker has no expiry job. Submissions stay until the operator deletes
them. The site sets no cookies, and its requests are sent with credentials
omitted.

Who can export: only the holder of the Worker's export token, which is sent as
a bearer token. An export lists the fields above for one puzzle and leaves out
the client id.

## Sharing sends nothing

Pressing share builds the text on your device and copies it to your
clipboard. The site makes no request when you share, and there is no share
ping.

### Custom links

A custom puzzle link looks like `#/c/<payload>`. The payload is the puzzle
itself, encoded as URL-safe base64 JSON: the label, unit and source, 28 visible
values, the 7 real values and the AI forecast. It sits in the URL fragment,
which a browser never sends to a server, so the site's host does not receive
it. It is not encrypted: anyone you give the link to can decode it.

## History file schema

The download from `#/data` is named `forecastle-history-YYYY-MM-DD.json`, dated
in your local calendar. It is a JSON array with one object per play, followed by
one object per live entry in the live entry schema below. Only a live entry has
a `status` field. Each play has these fields:

| Field           | Type                                                            |
| --------------- | --------------------------------------------------------------- |
| `schemaVersion` | `1`                                                             |
| `puzzleId`      | non-empty string                                                |
| `kind`          | `"daily"`, `"live"` or `"custom"`                               |
| `playedOn`      | local date, `YYYY-MM-DD`                                        |
| `path`          | 7 finite numbers                                                |
| `halfWidth`     | number greater than 0                                           |
| `closeness`     | integer, 0 to 100                                               |
| `aiCloseness`   | integer, 0 to 100                                               |
| `coverage`      | integer, 0 to 7                                                 |
| `stats`         | `null`, or `{ count, median[7], p10[7], p90[7], quartiles[3] }` |

A restore rejects the whole file if any record breaks this schema, except that
missing or malformed `stats` restores as no crowd line.

## Live entry schema

`forecastle.v1.live` is a JSON array with one object per locked live chart, and
the history file carries the same objects:

| Field           | Type                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| `schemaVersion` | `1`                                                                                                          |
| `puzzleId`      | non-empty string, the chart id                                                                               |
| `path`          | 7 finite numbers                                                                                             |
| `halfWidth`     | number greater than 0                                                                                        |
| `msToLock`      | integer, 0 to 3,600,000                                                                                      |
| `status`        | `"sent"` (the Worker holds it), `"unsent"`, `"kept"` (crowd line off) or `"unserved"` (no Worker configured) |
