The `hello-world.txt` and `incomplete.txt` files and their detached timestamps are
verification vectors from the OpenTimestamps client examples:
https://github.com/opentimestamps/opentimestamps-client/tree/master/examples

`hello-world.txt.ots` already contains its Bitcoin attestation. `incomplete.txt.ots`
contains pending attestations. Offline verification disables calendar access.

The recorded block responses are from:
https://blockstream.info/api/block-height/358391
and the corresponding `/api/block/<hash>` response.

The synthetic live fixture has its own timestamp, separate from these vectors.
It cannot verify until that timestamp is anchored and upgraded. Its forecasts
are intentionally identical, so the same detached proof applies to all six
identical forecast files.
