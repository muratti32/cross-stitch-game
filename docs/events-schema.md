# First-party Gameplay Events schema

`analytics.gameplay_events` is the first-party, pseudonymous event stream from ADR-0035. It is separate from `economy.gameplay_events`, which remains the Daily Task evidence stream.

The table is monthly range-partitioned on `occurred_at`. It retains the current month and the preceding 12 calendar months (13 calendar months total, `GAMEPLAY_EVENT_RETENTION_MONTHS`). The worker provisions the current and next month every `GAMEPLAY_EVENT_PARTITION_MAINTENANCE_INTERVAL_SECONDS` and drops older partitions as whole tables, so storage is bounded without row-by-row deletes.

Ingest is idempotent on the `(event_id, occurred_at)` primary key, which is dropped along with its partition. There is deliberately no separate event-id registry table: an unpartitioned one would outlive every partition and grow without bound, defeating the retention guarantee. The trade-off is that idempotency is scoped to the retained window, which is all a client retry needs.

Because partitions are provisioned from the accepted events themselves, `occurred_at` is bounded on ingest: an event older than the retention window, or more than 24 hours in the future, is rejected with HTTP 400 rather than causing a partition to be created for an arbitrary month.

Every event has `event_id` (client UUID), `occurred_at` (ISO-8601 timestamp), and `kind`. The authenticated principal supplies the only identity columns: `principal_type` (`guest` or `account`) and opaque `principal_id`. Payloads are exact objects: omitted required fields, unknown fields, unknown kinds, text blobs, prompt text, artwork, Pattern bytes, email, and provider identifiers are rejected with HTTP 400.

| Kind | Exact payload fields |
| --- | --- |
| `session_started` | `session_id` (UUID) |
| `session_completed` | `session_id` (UUID) |
| `daily_task_completed` | `task_key`: `cells_100` \| `three_colors_10` \| `color_completion` |
| `pattern_conversion_started` | `source_artwork_kind`: `photo_artwork` \| `ai_artwork`; `conversion_profile`: `easy` \| `standard` \| `detailed` \| `custom` |
| `pattern_conversion_completed` | `source_artwork_kind`: `photo_artwork` \| `ai_artwork` |
| `pattern_conversion_failed` | `source_artwork_kind`: `photo_artwork` \| `ai_artwork`; `failure_stage`: `upload` \| `conversion_engine` \| `delivery` |
| `ai_generation_started` | `aspect`: `square` \| `portrait_4_3` \| `landscape_4_3` |
| `ai_generation_prompt_blocked` | no fields (`{}`) |
| `ai_generation_completed` | `aspect`: `square` \| `portrait_4_3` \| `landscape_4_3` |
| `ai_generation_failed` | `failure_stage`: `prompt_safety` \| `provider_submission` \| `provider_safety` \| `delivery` |
| `purchase_started` | `product_kind`: `premium_membership` \| `ai_credit_pack` \| `stitch_coin_pack` |
| `purchase_completed` | `product_kind`: `premium_membership` \| `ai_credit_pack` \| `stitch_coin_pack` |
| `purchase_cancelled` | `product_kind`: `premium_membership` \| `ai_credit_pack` \| `stitch_coin_pack` |
| `purchase_failed` | `product_kind`: `premium_membership` \| `ai_credit_pack` \| `stitch_coin_pack`; `failure_stage`: `store` \| `verification` \| `grant` |

The API accepts up to 500 events at `POST /v1/events`. It returns `accepted: true` for both new and replayed event identifiers, allowing the client to safely prune its local queue. The read service exposes per-kind daily counts for an ascending date range; it does not expose individual player events.
