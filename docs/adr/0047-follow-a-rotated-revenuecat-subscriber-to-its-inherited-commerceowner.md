# Follow a rotated RevenueCat subscriber to its inherited CommerceOwner

> This ADR widens ADR-0032's TRANSFER rule, which moved a Membership only onto a destination Registered Account, and extends the subscriber mapping ADR-0045 introduced for Guest Stitch Coin commerce. It does not weaken the requirement that every grant comes from a verified RevenueCat webhook carrying a real provider transaction.

RevenueCat mints a new anonymous subscriber identifier whenever the app signs out of a Registered Account, and moves the store purchases already attached to the device onto that identifier. It reports the move as a TRANSFER whose `transferred_to` is that brand new identifier: neither a Registered Account nor a mapped Guest Installation Identity. The Game Backend previously required `transferred_to` to resolve to exactly one active Registered Account, so this transfer was refused, and every later event for the same subscription — RENEWAL above all — arrived under an identifier that resolved to no principal and was rejected as an unknown account. The paying player kept their store subscription while the Membership stopped reconciling, with no operator-visible failure beyond a warning line.

A TRANSFER now resolves its destination in order: an active Registered Account named by `transferred_to`; a subscriber mapping already claiming one of those identifiers; and finally the owner inherited from `transferred_from`, in which case the destination identifiers are claimed for that owner so the following events resolve. A Membership therefore moves onto a Guest Installation Identity as well as onto a Registered Account, and `economy.membership_events` and `economy.membership_periods` carry whichever owner column the destination requires. Where a transfer's source carries both an active Registered Account and a Guest mapping the event alone cannot say which of them owns the subscription, so the transfer is refused as an alias conflict rather than guessed.

Subscriber mappings are read as a `CommerceOwner` rather than as a Guest reference. A promoted Guest leaves an account-owned mapping row behind (ADR-0046's promotion handoff rewrites it), so membership and one-time purchase events whose app user id resolves to such a row are applied to that Registered Account instead of being rejected.

The mobile app reads the subscriber identifier only after the RevenueCat identity has settled, and re-claims the identifier the store actually purchased under when it differs. Reading it first let a queued sign-out rotate the identifier between the mapping write and the purchase, which produced the same unresolvable webhook for a purchase the player had just paid for.

## Consequences

- A player who signs out and continues as a Guest keeps a reconciling Premium Membership; the entitlement follows the store purchases rather than staying on the abandoned identity.
- Membership rows can now be moved onto a Guest Installation Identity by a transfer, so the exactly-one-owner check on those tables is satisfied by the guest column rather than always by `account_id`.
- A transfer whose source is ambiguous (an active Registered Account and a Guest mapping together) is refused as `guest_subscriber_alias_conflict` and needs operator resolution; it is not silently attributed.
- Subscriber mappings are authoritative for ownership in both directions, so a stale mapping misroutes grants until it is corrected; mapping writes stay first-claim as ADR-0045 already accepted.
- Events rejected before this decision are not repaired automatically; RevenueCat redelivery or an operator replay of the stored webhook is required.
