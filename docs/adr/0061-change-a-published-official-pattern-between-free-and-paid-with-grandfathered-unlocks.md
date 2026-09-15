# Change a published Official Pattern between free and paid with grandfathered unlocks

**Status: accepted**

Operators may change an eligible published Official Pattern between free and paid. Eligible Patterns are operator-owned catalog Patterns in available, withdrawn, or review-hold status. Community Patterns and removed Patterns cannot use this operation.

The operator supplies only whether the Pattern is paid. For a paid Pattern, the backend derives its Pattern Unlock Price Tier from the stitchable-cell count recorded by the Official Pattern Draft that published it. If that count is unavailable, making the Pattern paid fails. Official Patterns published without an Official Pattern Draft stitchable-cell count, such as seeded Patterns, cannot be made paid until a count is available. ADR-0011's cell ranges and fixed prices remain unchanged.

Changing a free Pattern to paid grants a zero-cost Grandfathered Pattern Unlock to every Registered Account and Guest Installation Identity that has any Stitching Session for the Pattern. Session status, progress, and stitch count do not affect eligibility. Existing Pattern Unlocks remain unchanged, and the grant creates no Coin Ledger entry. The primary key makes repeated grants idempotent.

The Pattern row is locked in the same transaction and with the same write-lock mode used by Session Preparation. A concurrent preparation therefore either creates its session before the change and receives a Grandfathered Pattern Unlock, or observes the paid tier and must already have an Unlock. The tier update, grants, and operator audit entry commit together.

Changing a paid Pattern to free does not refund Stitch Coin and does not delete existing Pattern Unlocks. Changing it back to paid grants only missing Unlocks, so existing coin-spend and grandfathered records retain their provenance.

Single changes fail for an unknown or ineligible Pattern. Bulk changes process Pattern IDs sequentially in canonical order, with one transaction per Pattern. A failed Pattern does not roll back successful Pattern changes, and the response reports each result.

Each effective change writes `pattern.paid_change` to the Operator Audit Log with the actor, Pattern, previous and new tiers, requested paid state, grandfathered count, and request ID. An unchanged request writes neither the Pattern nor an audit entry.

Operator routes use the existing operator authentication and `catalog.pattern.manage` permission. The routes rely on the existing operator session, which completes the TOTP or recovery-code challenge unless the deployment-wide `ADMIN_MFA_ENABLED` bypass is set; the bypass is recorded as `mfa_bypassed`. This ADR adds no separate MFA mechanism. The guard validates the dedicated operator signature, issuer, audience, and principal type.

This extends ADR-0039, which defined the publish-time free-or-paid choice and derived tier. It does not change ADR-0011's price rule.

## Considered options

- Refund Coin when changing paid to free: rejected because Pattern Unlocks are permanent acquisitions and a later catalog policy change does not reverse the original spend.
- Grandfather only active sessions: rejected because completed and otherwise inactive sessions are evidence that the player already started the Pattern.
- Accept a manual tier or price: rejected because it could diverge from ADR-0011 and the Pattern's authoritative stitchable-cell count.
- Reuse the title-and-creator-name publication upsert path: rejected because a price-policy change must update the identified locked Pattern without republishing or changing its content identity.
