# Let operators manage a single global Locator Price

**Status: accepted**

The Remaining Cell Locator charges the current Locator Price instead of a fixed 1 Stitch Coin. The Locator Price is one global whole number from 1 to 10, is the same for Guest Players and Registered Accounts, gives no Premium Membership discount, and is still charged once per successful use. It is the first Stitch Coin value an operator can change; every other economy amount stays defined in code.

A new operator permission controls the Locator Price. Each change takes effect immediately and records the previous and new amounts in the operator audit log. A migration sets the starting value to 1. If the stored value cannot be read, reservation fails rather than making the locator free. The backend reads the price inside each reservation transaction without caching, so every backend instance applies a change at once. Each Locator Attempt locks the price at reservation, and its commit, release, and expiry use that locked amount. The client shows the price it last received with the Stitch Coin balance and sends it as the expected price. A reservation that does not match the current price is rejected without charge. The client then shows the new price, and the player must tap again; the client never retries on its own. Every reserve, commit, and release ledger entry records the price it used; the `locator_price_changed` rejection writes nothing.

This supersedes only the fixed-1-Coin clause of ADR-0058. Its reservation, idempotency, no-charge, and ADR-0031 rendering rules stay in force.

## Considered options

- Keep a fixed price in code: rejected because every price change would need a client and backend release.
- Build a general Economy Settings console for rewards, unlock tiers, and the locator price: rejected for now because those values are tied to ledger and completion reward rules that carry separate risks.
- Set the price per Pattern or per Pattern Unlock Price Tier: rejected because the locator gives no lasting advantage and does not need catalog-level complexity.
- Allow a price of 0: rejected because ADR-0058 already rejected a free locator, and a zero-amount reservation has no meaning.
- Charge the price that is current at commit: rejected because a change during the 60-second reservation could charge an amount different from what was held or shown.
