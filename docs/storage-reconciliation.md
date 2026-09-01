# Storage reconciliation cadence

The jobs worker verifies that every active object registry row still has a file
in object storage. The sweep is bounded so its cost scales with the configured
batch size, not with the size of the bucket.

## Bounded sweep

- The worker ticks every `STORAGE_RECONCILER_INTERVAL_SECONDS` (default 300).
- Each tick verifies at most `STORAGE_RECONCILER_BATCH_SIZE` rows (default 250)
  in state `committed` or `available`, and at most the same number of stuck
  `uploading` rows.
- A row is only re-checked when its `last_verified_at` is older than
  `STORAGE_OBJECT_VERIFICATION_INTERVAL_SECONDS` (default 86400) or is null.
  Rows are picked oldest-first, never-verified rows first, so every active
  object is checked about once per verification interval.
- Passes never overlap: while one pass is in flight, further ticks return
  immediately as skipped instead of starting a second sweep.

Steady-state remote `HeadObject` volume is therefore bounded by
`active rows / verification interval`, capped at
`batch size × (86400 / interval)` requests per day. With the defaults and 6K
active objects that is 6K checks/day, against roughly 8.6M/day before the change
(a full bucket sweep every 60 seconds, issue #219).

## Operator reconciliation report

The read-only report behind the reconciliation run derives both missing objects
and orphans from a single paginated bucket listing, so it costs one `list` per
run instead of one `HeadObject` per active object. It runs every
`RECONCILIATION_INTERVAL_SECONDS` (default 900) and never mutates registry rows.

## Verifying a deployment

After deploying, compare the bucket's Class B operation rate with the number of
active object registry rows. The daily request count should approach the number
of active rows, not a multiple of it.
