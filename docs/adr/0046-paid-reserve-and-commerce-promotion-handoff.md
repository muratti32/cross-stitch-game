# Paid reserve and Commerce Promotion handoff

## Status

Accepted for Issue #111.

## Decision

Coin and AI Credit balance rows retain a `paid_balance` reserve. It is increased only by verified provider purchase ledger entries (`coin_pack_purchase` and `pack_purchase`). Membership Credit Grant and Premium Daily Coin Claim remain free recurring benefits because their value transfers with the Membership Period and must not be counted twice. Ordinary positive grants are free. Debits consume the free portion first. A Commerce Reversal reduces the paid reserve first, while a Membership Reversal consumes free balance first because its Membership Credit Grant never entered the paid reserve; either may leave the signed total balance negative.

Registration/sign-in creates a durable Commerce Promotion handoff keyed by Guest Installation Identity and Registered Account. The handoff is the retry unit. Paid reserves, private content, commerce bindings, and membership ownership are moved under deterministic idempotency keys in one transaction. Membership Credit Grant / Membership Reversal source keys are owner-independent and keyed by provider transaction; existing Guest-keyed rows are migrated. Reward Day pools merge conservatively on handoff: consumption uses GREATEST and premium claims use OR, preventing a Premium Daily Coin Claim from repeating after the identity change. The handoff is executed by the Job Outbox worker, not inline, so `Syncing purchases` is observable. The Guest Installation Identity remains intact until the handoff is durably acknowledged; the existing free Guest Economy Promotion remains responsible for its own final revocation and data drain.

No `paid_balance <= balance` constraint is imposed: a reversal can make the signed balance negative while the reserve remains non-negative.

## Consequences

Existing balances are backfilled by replaying ledger history in creation order, allocating free value before paid value and applying reversals against paid value first. Handoff status exposes only an opaque handoff id, lifecycle, retry count, and actionable failure text; provider identifiers are not returned.
