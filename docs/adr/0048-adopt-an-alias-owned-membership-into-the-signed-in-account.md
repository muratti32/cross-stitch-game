# Adopt an alias-owned Membership into the signed-in Registered Account

> This ADR narrows ADR-0032's ownership guard, which refuses any membership event whose provider transaction is already recorded for a different owner, and complements ADR-0046's promotion handoff and ADR-0047's transfer inheritance. It does not weaken the requirement that every grant comes from a verified RevenueCat webhook carrying a real provider transaction.

Signing in to a Registered Account the player already had is not a TRANSFER for RevenueCat: it aliases the Guest's anonymous subscriber onto the account identifier and keeps delivering the same subscription, now with `app_user_id` set to the account. The Membership rows still name the Guest Installation Identity that bought it, because ADR-0046's handoff rewrites ownership only when a Guest is promoted into a *new* account. The ownership guard therefore saw a conflict for a subscription that never changed hands, answered `503` so the delivery would be retried, and every retry hit the same refusal — the player kept paying while the Membership stopped reconciling, and the operator saw only a fraud-signal warning.

A refused membership event is now re-examined before it is reported as a conflict. When every recorded owner of that provider transaction is one Guest Installation Identity, and the event's own alias list still maps to that same Guest, the Membership is moved onto the Registered Account the event names and the aliased subscriber identifiers are claimed for that account; the event is then recorded normally. RevenueCat states those identifiers belong to one customer, so the claim is the same player arriving through a new identity rather than a second player reaching for a purchase they never made.

Adoption is deliberately narrow. A transaction whose rows name another Registered Account is still refused as `rejected_other_account`, as is an alias list where any identifier is claimed by a principal other than that Guest or the signing-in account. Those cases stay a `503` so a later delivery — or an operator — can resolve them.

## Consequences

- A player who buys as a Guest and later signs in to an existing account keeps a reconciling Premium Membership, and the Guest Installation stops reporting one.
- Subscriber mappings for the adopted aliases become account-owned, so later events for the same subscription resolve directly without another adoption.
- Account-to-account conflicts keep their existing fail-closed behaviour and their retry semantics; adoption never moves a Membership away from a Registered Account.
- Ownership can now change without a TRANSFER event, so the audit trail for a moved Membership is the adoption log line rather than a provider event.
- Memberships refused before this decision are not repaired automatically; RevenueCat redelivery or an operator replay of the stored webhook is required.
