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
| `com.avk.stitchwish.coin_pack_300` | 300 Stitch Coin | 1.99 | `6795039592` | 300 Stitch Coin | Adds 300 Stitch Coin to your balance. | `com.avk.stitchwish.coin_pack_300` | *pending* |
| `com.avk.stitchwish.coin_pack_900` | 900 Stitch Coin | 4.99 | `6795039941` | 900 Stitch Coin | Adds 900 Stitch Coin to your balance. | `com.avk.stitchwish.coin_pack_900` | *pending* |
| `com.avk.stitchwish.coin_pack_2000` | 2,000 Stitch Coin | 9.99 | `6795039791` | 2,000 Stitch Coin | Adds 2,000 Stitch Coin to your balance. | `com.avk.stitchwish.coin_pack_2000` | *pending* |
| `com.avk.stitchwish.ai_credit_pack_5` | 5 AI Credit | 2.99 | `6795039860` | 5 AI Credits | Adds 5 AI Credits for AI artwork. | `com.avk.stitchwish.ai_credit_pack_5` | *pending* |
| `com.avk.stitchwish.ai_credit_pack_20` | 20 AI Credit | 9.99 | `6795039890` | 20 AI Credits | Adds 20 AI Credits for AI artwork. | `com.avk.stitchwish.ai_credit_pack_20` | *pending* |
| `com.avk.stitchwish.ai_credit_pack_50` | 50 AI Credit | 19.99 | `6795039687` | 50 AI Credits | Adds 50 AI Credits for AI artwork. | `com.avk.stitchwish.ai_credit_pack_50` | *pending* |

Reference name equals the unqualified key (`coin_pack_300`, …) for traceability against the backend catalog.

## Subscriptions

Apple subscription group `Premium Membership`, group ID `22267302`, `en-US` group display name "Premium Membership". Family Sharing **off** on all three (ADR-0043). Auto-renewable.

| Product ID | Period | Group level | Credits per paid period | US price | Apple subscription ID | Display Name | Description | Play product ID | RevenueCat |
|---|---|---|---|---|---|---|---|---|---|
| `com.avk.stitchwish.premium_annual` | ONE_YEAR | 1 | 180 | 39.99 | `6795040080` | Premium Annual | 180 AI credits yearly, themes, daily coins. | `com.avk.stitchwish.premium_annual` (base plan `annual`) | *pending* |
| `com.avk.stitchwish.premium_monthly` | ONE_MONTH | 2 | 15 | 7.99 | `6795040225` | Premium Monthly | 15 AI credits monthly, themes, daily coins. | `com.avk.stitchwish.premium_monthly` (base plan `monthly`) | *pending* |
| `com.avk.stitchwish.premium_weekly` | ONE_WEEK | 3 | 3 | 2.99 | `6795040253` | Premium Weekly | 3 AI credits weekly, themes, daily coins. | `com.avk.stitchwish.premium_weekly` (base plan `weekly`) | *pending* |

Introductory offer: `com.avk.stitchwish.premium_monthly` only — `FREE_TRIAL`, `THREE_DAYS`, 1 period, created in all 175 territories (verified 175/175 on 2026-07-27; the original `ONE_WEEK` offers were deleted and recreated, because `asc subscriptions offers introductory update` can only move the end date, not the duration). Weekly and Annual have none. Eligibility is consumed per group, so any prior Premium Plan disqualifies a player from the Monthly Trial (`CONTEXT.md`, Monthly Trial). On Play the same trial is an offer on the `monthly` base plan of `com.avk.stitchwish.premium_monthly`, with a 3-day free-trial phase, created 2026-07-27.

**Play product ID history (2026-07-27):** Monthly and Weekly were first created on Play as `premium_monthly` and `weekly`, breaking the one-string rule of ADR-0043 — the backend resolves grants by exact match on RevenueCat's `product_id`, so Android purchases of those two would have granted nothing. Play product IDs cannot be renamed or reused, so both were deactivated and recreated under the reverse-DNS IDs recorded above. The dead `premium_monthly` and `weekly` IDs stay burned in the Play namespace and must never be reused.

## Pricing and availability

- Base territory United States; all other territories use Apple's automatic price equalisation from the US price point.
- The app is available in all 175 App Store territories with "available in new territories" enabled (`appAvailabilities/6792383323`, verified 175/175 on 2026-07-27).
- All three subscriptions are available in all 175 territories with "available in new territories" enabled.
- All six consumables carry an explicit `inAppPurchaseAvailabilities` record set to the same 175 territories with "available in new territories" enabled, rather than inheriting app availability implicitly. Note that `asc` exposes no readback for a consumable's territory list, so this is verified by the accepted write and the `availableInNewTerritories: true` attribute, not by enumerating the territories.

The app availability record could not be bootstrapped through the API or an Apple web session: `asc pricing availability edit` only edits an existing record, and `asc web apps availability create` returned HTTP 404 on 2026-07-27 for both a 175-territory payload and a single territory, while the same web session reached the app through other endpoints. The record was created in the App Store Connect UI instead. If a future app needs the same bootstrap, expect to do that step by hand.

## Review state

All nine products are in `READY_TO_SUBMIT` (verified 2026-08-06). Apple requires first-release in-app purchases to be submitted together with the first App Store version, so they stay in this state until the `1.1` version submission carries them through review.

## Google Play

Provisioned 2026-07-27 under the same product ID strings; Play accepts lowercase letters, digits, underscore, and period, and the identifiers above satisfy that. The shape, kept here so a future product is added the same way:

- Six consumables → Play "in-app products", one per row above, with the same US price.
- Three Premium Plans → Play "subscriptions". Play models a subscription as a subscription ID plus one or more base plans; create one auto-renewing base plan per product with the matching billing period.
- The 3-day trial is a Play *offer* attached to the `com.avk.stitchwish.premium_monthly` base plan, with a free-trial phase of 3 days.
- Play has no subscription-group concept; mutual exclusivity between the three plans is enforced by putting them in the same Play subscription only if desired, otherwise by the backend's single-active-membership projection.
- Record the RevenueCat product/entitlement/offering identifiers in the `pending` columns above once created.

## RevenueCat

Provisioned 2026-07-27. Project `Stitch Wish` = `projf2795a83`; apps `Stitch Wish iOS` = `app5adf5224e0` (`app_store`, `com.avk.stitchwish`) and `Stitch Wish Android` = `app9943323f25` (`play_store`, `com.avk.stitchwish`).

Each of the nine products exists twice, once per app, so an offering serves both platforms (ADR-0032). Entitlement `premium` = `entl57a71f4adf` carries the six subscription products. Offering `default` = `ofrng489e2fe72c` is current and holds nine packages, each with the iOS and Android product attached at eligibility `all`: `$rc_weekly`, `$rc_monthly`, `$rc_annual`, then `$rc_custom_coin_pack_300`, `$rc_custom_coin_pack_900`, `$rc_custom_coin_pack_2000`, `$rc_custom_ai_credit_pack_5`, `$rc_custom_ai_credit_pack_20`, `$rc_custom_ai_credit_pack_50`.

**Base-plan suffix.** Play models a subscription as a product plus a base plan, so the three Android subscriptions are registered as `com.avk.stitchwish.premium_weekly:weekly`, `…premium_monthly:monthly`, and `…premium_annual:annual` — the only place the two stores do not share a byte-identical string. The backend and the client therefore truncate at the first colon before every catalog lookup (`backend/src/economy/store-product-id.ts`, `storeProductKey` in `app/app/(tabs)/(profile)/commerce.tsx`); Apple identifiers contain no colon, so the rule is a no-op there. Play consumables carry no suffix.

**Test Store.** App `Test Store` = `appd8faa0a6a2` is created with every project and carries the same nine identifiers again, without the Play base-plan suffix, so a development build can exercise the paywall and the grant path with no store account. Each test product carries its US price, the three subscriptions carry `P1W` / `P1M` / `P1Y`, and all nine are attached to the same packages as the store products; the three subscriptions are on the `premium` entitlement. Test Store products require a `title`, unlike store products. The Monthly test product has a **3-day free trial** (`P3D`) for customers who have never made a purchase. `trial_duration` cannot be set through the API, so this is configured in the RevenueCat dashboard.

Still to do before real purchases work: App Store Connect API key and subscription status URL on the iOS app, Play service-account credentials on the Android app, prices imported from the stores, and the webhook pointed at the backend's RevenueCat endpoint with its shared secret.
