# Store Products

Canonical cross-store catalog of every real-money product. One product identifier serves App Store Connect, Google Play, RevenueCat, and the backend grant catalog (ADR-0043); the same string must appear in all four or a verified purchase grants nothing.

Backend catalog of record: `backend/src/economy/commerce.constants.ts` and `backend/src/economy/membership.constants.ts`. Client copy: `app/app/(tabs)/(profile)/commerce.tsx`.

Pack contents and United States prices are fixed by ADR-0011 and `CONTEXT.md`; changing them requires a decision update, not an edit here.

## Apple — app

| Field | Value |
|---|---|
| App Store app ID | `6792383323` |
| Bundle identifier | `com.avk.stitchwish` |
| `asc` profile | `avk-asc` |
| Created | 2026-07-27 |

## Consumables

Type `CONSUMABLE`. Family Sharing not applicable. Locale `en-US` only.

| Product ID | Grants | US price | Apple IAP ID | Display Name | Description | Play product ID | RevenueCat |
|---|---|---|---|---|---|---|---|
| `com.avk.stitchwish.coin_pack_300` | 300 Stitch Coin | 1.99 | `6795039592` | 300 Stitch Coin | Adds 300 Stitch Coin to your balance. | *pending* | *pending* |
| `com.avk.stitchwish.coin_pack_900` | 900 Stitch Coin | 4.99 | `6795039941` | 900 Stitch Coin | Adds 900 Stitch Coin to your balance. | *pending* | *pending* |
| `com.avk.stitchwish.coin_pack_2000` | 2,000 Stitch Coin | 9.99 | `6795039791` | 2,000 Stitch Coin | Adds 2,000 Stitch Coin to your balance. | *pending* | *pending* |
| `com.avk.stitchwish.ai_credit_pack_5` | 5 AI Credit | 2.99 | `6795039860` | 5 AI Credits | Adds 5 AI Credits for AI artwork. | *pending* | *pending* |
| `com.avk.stitchwish.ai_credit_pack_20` | 20 AI Credit | 9.99 | `6795039890` | 20 AI Credits | Adds 20 AI Credits for AI artwork. | *pending* | *pending* |
| `com.avk.stitchwish.ai_credit_pack_50` | 50 AI Credit | 19.99 | `6795039687` | 50 AI Credits | Adds 50 AI Credits for AI artwork. | *pending* | *pending* |

Reference name equals the unqualified key (`coin_pack_300`, …) for traceability against the backend catalog.

## Subscriptions

Apple subscription group `Premium Membership`, group ID `22267302`, `en-US` group display name "Premium Membership". Family Sharing **off** on all three (ADR-0043). Auto-renewable.

| Product ID | Period | Group level | Credits per paid period | US price | Apple subscription ID | Display Name | Description | Play product ID | RevenueCat |
|---|---|---|---|---|---|---|---|---|---|
| `com.avk.stitchwish.premium_annual` | ONE_YEAR | 1 | 180 | 39.99 | `6795040080` | Premium Annual | 180 AI credits yearly, themes, daily coins. | *pending* | *pending* |
| `com.avk.stitchwish.premium_monthly` | ONE_MONTH | 2 | 15 | 7.99 | `6795040225` | Premium Monthly | 15 AI credits monthly, themes, daily coins. | *pending* | *pending* |
| `com.avk.stitchwish.premium_weekly` | ONE_WEEK | 3 | 3 | 2.99 | `6795040253` | Premium Weekly | 3 AI credits weekly, themes, daily coins. | *pending* | *pending* |

Introductory offer: `com.avk.stitchwish.premium_monthly` only — `FREE_TRIAL`, `ONE_WEEK`, 1 period, created in all 175 territories. Weekly and Annual have none. Eligibility is consumed per group, so any prior Premium Plan disqualifies a player from the Monthly Trial (`CONTEXT.md`, Monthly Trial).

## Pricing and availability

- Base territory United States; all other territories use Apple's automatic price equalisation from the US price point.
- Subscriptions are available in all 175 App Store territories with "available in new territories" enabled.
- Consumables carry no explicit availability record, so they inherit app availability.
- **Open:** the app itself has no App Store availability record yet (`asc pricing availability view` returns "app availability not found"). Creating the initial record requires an Apple web session (`asc web apps availability create`), which needs an interactive Apple ID sign-in with 2FA. Until that is done, territory availability for the consumables is Apple's default rather than an asserted all-territories setting.

## Review state

All nine products are in `MISSING_METADATA`. This is expected before the first build: Apple requires a review screenshot per product and requires first-release in-app purchases to be submitted together with the first App Store version. Review screenshots and submission belong to the app-version submission work, not here.

## Reproducing on Google Play

Use the same product ID strings. Play accepts lowercase letters, digits, underscore, and period, and the identifiers above satisfy that.

- Six consumables → Play "in-app products", one per row above, with the same US price.
- Three Premium Plans → Play "subscriptions". Play models a subscription as a subscription ID plus one or more base plans; create one auto-renewing base plan per product with the matching billing period.
- The 7-day trial is a Play *offer* attached to the `com.avk.stitchwish.premium_monthly` base plan, with a free-trial phase of 7 days.
- Play has no subscription-group concept; mutual exclusivity between the three plans is enforced by putting them in the same Play subscription only if desired, otherwise by the backend's single-active-membership projection.
- Record the Play IDs and the RevenueCat product/entitlement/offering identifiers in the `pending` columns above once created.

## RevenueCat

Not provisioned. There is no RevenueCat project for Stitch Wish yet; the project, iOS and Android apps, nine products, entitlement, and offering are created once the Play products exist so both platforms land in one offering (ADR-0032).
