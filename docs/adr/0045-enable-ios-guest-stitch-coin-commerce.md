# Enable iOS Guest Stitch Coin commerce

> This ADR narrows, not overrides, ADR-0032's rule that grants only webhook events whose subscriber identity resolves to a Registered Account, and ADR-0012's Registered-Account-only Commerce Transaction Binding. This ADR deliberately adds one bounded exception for iOS Guest Stitch Coin Pack Purchase Attempts; all other Guest products and lifecycle flows remain outside its scope.

Issue #108 enables one narrow Guest commerce path. On iOS, a Guest Player may buy a Stitch Coin Pack without registration. RevenueCat keeps its anonymous subscriber identifier; the Game Backend maps that identifier to the authenticated Guest Installation Identity before creating a Purchase Attempt. The raw Guest identity is never passed to RevenueCat.

The Game Backend creates a durable Purchase Attempt before StoreKit opens. It owns product, CommerceOwner, subscriber association, idempotency key, lifecycle state, and opaque Support Reference. StoreKit and RevenueCat success only move the attempt toward verification. A verified RevenueCat webhook resolves current or historical subscriber aliases and the Commerce Ledger grants the exact pack to the Guest Ledger through the existing provider-transaction binding. Binding and ledger source keys make duplicate, replayed, delayed, and concurrent deliveries idempotent. An account-owned app user id is resolved before aliases so a historical Guest alias cannot shadow a Registered Account purchase.

Guest Premium, AI Credit, restore, promotion, refund, and deletion flows remain outside this decision. Android Guest purchase remains disabled; the backend requires its enabled capability and an iOS app User-Agent observed on the request, while the mobile path also checks iOS. The anonymous RevenueCat subscriber id is unguessable in normal SDK operation, but the mapping endpoint is still a first-claim correlation boundary rather than proof of provider session ownership; support and reconciliation must treat a suspicious mapping as a residual risk.

## Consequences

- Guest Stitch Coin grants are server-authoritative but owned by a Guest Installation Identity, using the CommerceOwner and existing provider-transaction idempotency rules.
- Account-owned commerce remains backward compatible, including account webhooks carrying historical Guest aliases.
- Guest commerce is capability- and iOS-gated at both mobile and backend boundaries; raw clients cannot enable Android Guest purchases by changing an application body field.
- The backend stores only a privacy-safe subscriber mapping and opaque Support Reference; the raw Guest Installation Identity is never sent to RevenueCat.
- The RevenueCat anonymous id is not correlated cryptographically to the caller's SDK session. Its normal UUID unpredictability limits practical guessing, but a malicious caller who obtains one can attempt a first claim; later identity and ledger conflicts remain fail-closed.
