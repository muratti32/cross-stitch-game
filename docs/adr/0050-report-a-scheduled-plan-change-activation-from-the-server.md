# Report a Scheduled Plan Change activation from the server that observes it

`subscription_change_completed` for a Scheduled Plan Change is recorded by the Game Backend, from the same Membership projection that made the change visible. When a verified Membership Event produces a Membership Period whose product fulfils an earlier PRODUCT_CHANGE on the same subscription lineage, and that change was a downgrade, the activation is written to `analytics.gameplay_events` under a name-based event identifier derived from the plan-change request. The Commerce Store no longer emits this kind at all; it keeps emitting `subscription_change_started` and `subscription_change_cancelled`, which are acts of the device in front of the player, and `subscription_change_completed` for a direct upgrade, which the requesting device reconciles in the same session.

The activation is not a client observation. It lands at the next renewal, days or a year after the session that requested the change, so a device-local memory of the scheduled state counts it once per install: twice for a player signed in on two devices, and never for one who reinstalls or simply does not open the Commerce Store while the change is pending. The store's own `NOT EXISTS` projection of a Scheduled Plan Change already names the activation exactly — a Membership Period for the target product on the lineage — so the server can state what the client could only infer.

Deriving the event identifier from the PRODUCT_CHANGE's provider event id, and its occurrence timestamp from the activated period's start, makes the ingest primary key `(event_id, occurred_at)` the whole idempotency story: a webhook redelivery, or a later event on the same subscription re-observing the same activation, inserts nothing.

## Consequences

- The count is per plan change rather than per device: a change requested on one device and activated while the player holds three is recorded once, and a player who never opens the store still contributes the event.
- The reported platform comes from the store the activating webhook names, since recorded Membership history keeps no store column. A subscription bought outside the App Store or Play Store reports nothing rather than guessing.
- An activation older than the gameplay event retention window is refused on ingest. That refusal is logged and swallowed: analytics never fails a webhook that already moved the entitlement.
- `purchase_completed` is still not emitted for a deferred change in either place. Nothing is granted when the change is scheduled, and the renewal that activates it grants the ordinary Membership Credit for a period rather than a purchase the player made.
- ADR-0049 stands as written except for its first consequence, which named the Membership read model on the device as the eventual source of this event; that half is what this decision replaces.
