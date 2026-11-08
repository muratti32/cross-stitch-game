# Grant Pattern Chart Images free on completion or early for Stitch Coin

**Status: accepted** (issue #287)

Players who also stitch on real fabric want a chart to work from. We sell a Pattern Chart Entitlement for Official Patterns. It lets the player generate one Pattern Chart Image: a PNG with the colored cell grid, bold lines every ten cells, a strip pairing each DMC Thread Color code with its swatch, and Stitch Wish branding with a QR code to the Pattern's Catalog Share Link. There is no PDF, skein count, pagination or fabric sizing. Any Session Completion of the Pattern, including a Replay Session, grants the entitlement at no cost. Before completion, a player may acquire it through a one-time, online, idempotent Stitch Coin spend of 20 Coin for Small, 40 for Medium and 60 for Large. Small, Medium and Large are the Completion Reward Tier cell ranges. The spend is available only for a Pattern the player may already start, meaning a free Pattern or one with a Pattern Unlock. That way a chart can never be a cheaper way into a paid Pattern. The purchase surface states that completion would grant it free, and completing after buying refunds nothing. The Coin price pays for having the chart earlier.

The entitlement is permanent and owned by a Registered Account or a Guest Installation Identity through the Guest Ledger (ADR-0026). It moves with Guest Economy Promotion (ADR-0027). Commerce Reversal never deletes it. The image is drawn on device from Offline Pattern Data, outside the stitching loop (ADR-0031), at 12 px per cell with the longest edge capped at 4096 px. The player can regenerate it at any time and hand it to the share sheet. Guest availability waits on #281.

Decided 2026-11-08: the Catalog Share Link is extended to published Official Patterns so the QR code has a Pattern-specific target, delivered as a separate prerequisite. A player who holds the entitlement but has no Offline Pattern Data on the device fetches the Pattern Artifact under the entitlement, without creating a Stitching Session, because Session Preparation would open a session the player did not ask for. A local Session Completion lets that device draw the image immediately, even offline; the backend writes the entitlement only when it accepts the completion. The first release covers Registered Accounts only; guest spends, grants and local drawing stay off until #281 closes, and a guest sees a sign-in prompt instead. A completion that Guest Data Promotion moves into an account grants the entitlement, because it records a finished Pattern rather than paying a First Completion Reward. Under Catalog Withdrawal the image can still be drawn from Pattern data already on the device, but new fetches and purchases stop. Under Safety Removal no image can be drawn, though the entitlement record stays.

Official Pattern artwork is generated with ChatGPT. OpenAI's terms assign output rights to the user, and purely AI-generated imagery attracts no copyright, so players may redistribute the image freely and the game does not try to restrict it. Each shared copy carries the brand and the QR code back to the catalog, which stays within ADR-0023's sharing scope.

Community Patterns are excluded because the Catalog Publication License covers distribution through the app only and grants no right to sell a creator's artwork. Personal Patterns are excluded because charging for them would break the rule that creation stays free.

## Considered options

- Free on completion only: rejected because stitchers want the chart before they start, and it would add no Coin spend.
- Coin only: rejected because a competitor gives the same chart free on completion, and a paywall on finished work reads as stingy.
- A detailed PDF with skein counts and pages: rejected as scope the player did not need. An image is enough to stitch from.
- A flat price: rejected because it is too expensive for Small Patterns. The existing cell tiers already scale.
