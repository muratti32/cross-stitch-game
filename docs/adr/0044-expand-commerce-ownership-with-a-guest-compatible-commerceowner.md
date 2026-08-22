# Expand commerce ownership with a Guest-compatible CommerceOwner

## Follow-up: Guest-owned Personal Patterns and visibility invariants

Issue #105 extends ownership widening to Guest-owned private AI Artwork and
Personal Patterns. `CHK_patterns_visibility_owner` therefore uses an
exactly-one-owner rule: a `personal` Pattern has either an Account or a Guest
Installation owner, while a `catalog` Pattern has neither. The database
constraint guarantees that a catalog-visible Pattern can never carry a Guest
owner (or an Account owner).

> This ADR narrows, not overrides, ADR-0011's "Only a Registered Account may purchase a pack," ADR-0012's Registered-Account-only Commerce Transaction Binding, and ADR-0032's rule that the Game Backend grants only webhook events whose subscriber identity resolves to a Registered Account. Those account-only purchase rules remain in force; this ADR only makes the schema able to hold a Guest-owned row once a later ticket deliberately enables that path.

`economy.commerce_transaction_bindings` gains a `CommerceOwner`: a nullable `account_id` foreign key into `auth.registered_accounts` and a nullable `guest_installation_id` foreign key into `auth.guest_installations`, guarded by one database constraint that requires exactly one of them to be set and keeps both in lockstep with the row's existing `principal_type`/`principal_id` columns. The existing columns, their values, and every query that reads them are left untouched; the migration only adds columns, backfills `account_id` from `principal_id` for the existing `'account'` rows, and widens the `principal_type` CHECK from the literal `'account'` to `IN ('account', 'guest')` so the column can, at the schema level, hold a Guest-owned row in the future. No code path writes a `'guest'` row today.

We introduce CommerceOwner now, ahead of any Guest purchase capability, so that Guest Installation Identity commerce (Issue #105's iOS-first Guest purchase work) can be built as an additive extension of the existing Commerce Ledger schema rather than a parallel table or a later breaking migration. Real foreign keys on `account_id` and `guest_installation_id` — rather than the existing untyped `principal_id` discriminator column alone — give the database itself referential integrity against both possible owner tables and let a single CHECK constraint reject zero-owner and two-owner rows, instead of relying only on application-level validation. A backend capability (reported through the commerce capabilities read model) states Guest commerce is unavailable; later, iOS-first tickets flip it on only after the purchase-attempt lifecycle, RevenueCat subscriber mapping, and reconciliation rules in Issue #105 are in place for Guest owners. Membership Periods, Membership Events, and every other commerce-adjacent table are intentionally left unchanged by this decision — they keep their existing account-only `account_id` column — because ADR-0012 and ADR-0032's binding, reconciliation, and reversal rules for those tables are governed separately and are out of scope until their own tickets extend them.

We accept two extra nullable columns and one more CHECK constraint on every existing and future Commerce Transaction Binding row, in exchange for an additive, backward-compatible migration that the previously released client is unaffected by (it never reads or writes `account_id`/`guest_installation_id` directly) and that later Guest commerce work does not have to re-migrate this table to add ownership support.

## Consequences

- The previously released mobile client is unaffected because it never reads or writes `account_id`/`guest_installation_id` directly.
- No backend code path writes a `principal_type='guest'` row today, and the commerce capability reports guest commerce unavailable until a later iOS-first ticket enables it.
- The CHECK constraint `CHK_commerce_transaction_bindings_owner` means any future guest write must set `principal_type='guest'` and `guest_installation_id=principal_id` with `account_id` NULL, or the insert fails.
- Membership Periods, Membership Credit Grants, and other commerce-adjacent tables stay account-only until their own tickets extend them.
- The migration's `down()` drops the two columns without attempting to un-backfill, so rolling back loses only the duplicated owner reference.
