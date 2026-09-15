# Charge Remaining Cell Locator with server-authoritative Stitch Coin

> The fixed 1-Stitch-Coin price in this ADR is superseded by ADR-0060 (operator-managed Locator Price). All other rules remain in force.

**Status: accepted**

Remaining Cell Locator is an online-gated action for both Guest Players and Registered Accounts: one successful use costs 1 Stitch Coin, while no-target, failure, cancellation, and offline use cost nothing. A Locator Attempt creates a 60-second hard Locator Reservation against spendable balance, commits exactly one idempotent ledger spend on success, and otherwise releases, expires, or rejects without charge; an unknown commit remains pending and retries under the same attempt identifier. The target is computed from local verified Pattern and progress, while the backend validates identity, session binding, balance, reservation ownership, idempotency, and lifecycle, retaining target metadata for audit rather than adding a new server-progress protocol for Guests.

This supersedes the free-locator pricing clauses in issue #6, ADR-0011, and ADR-0030; their other gameplay, economy, accessibility, and non-auto-fill rules remain in force. It preserves ADR-0031 by keeping renderer and gesture work local and treating reservation/commit as asynchronous commerce work, with one active attempt per principal/session, server-authoritative expiry, retry, rate limiting, and first-party lifecycle telemetry.

## Considered options

- Keep the locator free: rejected because #244 explicitly changes the economy contract.
- Charge immediately on the tap: rejected because cancellation, local failure, and concurrent devices could produce an invalid or duplicate charge.
- Validate every target through a new server-side progress protocol: rejected because Guest progress is intentionally local-first and the locator provides no persistent game advantage.
