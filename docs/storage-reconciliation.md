# Storage reconciliation cadence

The jobs worker verifies that every active object registry row still has a file
in object storage. The sweep is bounded so its cost scales with the configured
batch size, not with the size of the bucket.

## Current state: verification is off

`STORAGE_OBJECT_VERIFICATION_ENABLED` defaults to `false`, so the reconciler
issues **no** per-object `HeadObject` requests at all. Each tick still deletes
stuck `uploading` rows, and the operator reconciliation report below still
reports missing objects and orphans, because it derives both from one bucket
listing rather than per-object checks.

Set the variable to `true` to turn per-object verification back on; everything
in the next section then applies.

## Bounded sweep (when verification is enabled)

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
scan instead of one `HeadObject` per active object. It never mutates registry
rows.

The reconciliation run itself still ticks every `RECONCILIATION_INTERVAL_SECONDS`
(default 900), but the bucket listing behind it refreshes at most once per
`STORAGE_BUCKET_LISTING_INTERVAL_SECONDS` (default 86400). Between scans each run
replays the last scan's missing/orphan findings unchanged, so the reported counts
stay stable while the listing cost drops from 96 scans/day to 1. The cache lives
in the worker process, so a restart triggers a fresh scan on the next tick.

Listings are **Class A** object storage operations billed one request per 1000
keys, so before this cadence a bucket of N objects cost
`96 x ceil(N / 1000)` Class A requests per day (issue #222). It is now
`ceil(N / 1000)`.

## Verifying a deployment

After deploying, compare the bucket's Class B operation rate with the number of
active object registry rows. The daily request count should approach the number
of active rows, not a multiple of it.

For Class A, the daily count should be roughly `ceil(objects / 1000)` plus the
`PutObject` traffic from real uploads (each published Pattern writes an
artifact, a preview, and two thumbnails), with no flat overnight baseline.

A flat Class A baseline is far more likely to be `PutObject` than listings. The
account-level breakdown separates them:

```graphql
r2OperationsAdaptiveGroups(limit: 100, filter: { datetime_geq: $since, datetime_lt: $until })
{ sum { requests } dimensions { bucketName actionType actionStatus } }
```

Issue #223 was exactly that shape: the AI Artwork delivery poll re-copied the
provider output for every artwork stuck in `submitted`, once per tick, which is
one Class A write per pass. The poll now skips the upload when the object is
already in the bucket and logs a warning when a pass cannot finalize the row.
