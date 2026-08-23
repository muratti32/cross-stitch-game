# Release 1.1 build 15 preflight

## 1. Scope and status

This replacement release adds iOS Guest Stitch Coin purchases, durable purchase attempts, RevenueCat owner mapping, Guest-to-Account commerce promotion, refund/reversal recovery, and Account Deletion reauthentication. Domain boundaries remain those in [`CONTEXT.md`](../CONTEXT.md); canonical store identity and product state remain in [`app-metadata.md`](app-metadata.md) and [`store-products.md`](store-products.md).

**Status:** source implementation and automated evidence only. No TestFlight build, physical-device acceptance, App Store submission, issue closure, human acceptance, or App Review acceptance has occurred as part of this preflight.

## 2. Migration and backfill validation

Apply these additive migrations in timestamp order:

1. `1788912000000-AddCommerceOwnerToTransactionBindings.ts`
2. `1788998400000-CreateGuestCommercePurchaseAttempts.ts`
3. `1789084800000-AddCommerceOwnerToPremiumMembership.ts`
4. `1789171200000-AddGuestAiArtworkAndPatternOwnership.ts`
5. `1789257600000-AddPaidBalanceProvenance.ts`
6. `1789344000000-CreateCommercePromotionHandoffs.ts`
7. `1789344000001-FixCommercePromotionOwnership.ts`
8. `1789430400000-CreateCommerceGrantTombstones.ts`

They add tables, nullable owner/provenance columns, indexes, foreign keys, checks, ledger reasons, and backfills. They do not delete or rename a pre-existing Registered Account commerce column or route.

[`commerce-migration-backfill.integration-spec.ts`](../backend/test/commerce-migration-backfill.integration-spec.ts) inserts pre-existing account-shaped binding and Membership Period data, leaves Guest owner columns `NULL`, reruns the owner, paid-balance, and membership source-key backfills twice, proves the second execution is a no-op, proves the account is never reassigned to a Guest, and reads purchase balance, refund, and membership through the live API.

Re-run from `backend/` with a working Docker-compatible container runtime:

```bash
npx jest --config test/jest.integration.json --runInBand --forceExit test/commerce-migration-backfill.integration-spec.ts
```

Current result: **1 suite, 1 test passed** against a Postgres 16 testcontainer. Type-aware ESLint and `npm run typecheck` pass. This is automated evidence only; it says nothing about production data, which step 5 covers.

## 3. Automated evidence

Recorded branch baseline supplied for this release:

| Layer | Command | Result |
|---|---|---|
| Backend unit | `cd backend && npm test` | 87 suites, 492 tests passed |
| Backend integration | `cd backend && npm run test:integration` | 13 suites, 204 tests passed |
| App | `cd app && npm test -- --runInBand` | 45 suites, 357 tests passed |

Before submission, re-run all three commands and the focused migration command above. Record fresh output if counts change.

Coverage landmarks:

- All six consumables and all three Premium Plans: `app/src/commerce/__tests__/CommerceStoreScreen.test.tsx`, `app/src/commerce/__tests__/revenueCat.test.ts`, and `backend/test/backend.integration-spec.ts`.
- Purchase, refund, replay, TRANSFER, rollback, and support recovery: `backend/test/commerce-reversal-and-recovery.integration-spec.ts` (11 tests).
- Promotion: `backend/test/backend.integration-spec.ts` and its Commerce Promotion handoff cases.
- Restore: `app/src/commerce/__tests__/CommerceStoreScreen.test.tsx` and backend membership reconciliation cases.
- Authentication and Account Deletion reauthentication: `backend/test/account-deletion-reauth.integration-spec.ts` (11 tests) and `app/src/settings/__tests__/SettingsScreen.test.tsx` (10 tests).
- Pre-existing account data migration safety: `backend/test/commerce-migration-backfill.integration-spec.ts`.

Automated tests do not replace the physical reference-device gates in [`release-checklist.md`](release-checklist.md).

## 4. Previously released client compatibility

The backend change is additive for the shipped client:

- New routes: `GET /v1/commerce/capabilities`; `POST /v1/commerce/guest/revenuecat-mapping`; `POST /v1/commerce/guest/purchase-attempts`; `GET /v1/commerce/guest/purchase-attempts/:id`; `POST /v1/promotion/commerce-handoff`; `GET /v1/promotion/commerce-handoff/:handoffId`; `POST /v1/promotion/commerce-handoff/:handoffId/retry`.
- Existing route behavior retained: `/v1/commerce/revenuecat/webhook`, `/v1/commerce/membership`, `/v1/commerce/coin-packs/reconciliations`, `/v1/commerce/ai-credit-packs/reconciliations`, `/v1/economy/balance`, `/v1/economy/ai-credit-balance`, auth routes, and Account Deletion routes keep their existing client response shapes. Guest support is an additional principal path.
- Added nullable `guest_installation_id`: `economy.commerce_transaction_bindings`, `economy.premium_purchase_reconciliations`, `economy.membership_events`, `economy.membership_periods`, `ai.ai_artworks`, `ai.ai_credit_reservations`, `ai.prompt_safety_attempts`, `catalog.patterns`, `conversion.pattern_conversions`, and `conversion.personal_patterns`.
- Added nullable `account_id`: `economy.commerce_transaction_bindings` and `economy.revenuecat_subscriber_mappings`.
- Added non-breaking provenance column: `paid_balance bigint NOT NULL DEFAULT 0` on `economy.coin_balances` and `economy.ai_credit_balances`.
- New tables: `economy.revenuecat_subscriber_mappings`, `economy.purchase_attempts`, `promotion.commerce_promotion_handoffs`, and `economy.commerce_grant_tombstones`.

Re-verify by reviewing the eight migrations above, running all backend unit/integration suites, and smoke-testing the existing account routes before capability enablement. Compare controller DTOs/serializers for the existing routes; do not infer compatibility only from successful migration.

## 5. Backend deployment order and capability enablement

1. Keep `ENABLE_IOS_GUEST_COMMERCE=false`.
2. Run the backend's normal TypeORM migration command for the target environment. Verify `migrationsRun=false` deploy policy is respected and query `migrations` for all eight timestamps; also inspect constraints and nullable columns with PostgreSQL catalog queries.
3. Deploy API, workers, and outbox code. Verify the normal backend health check used by the deployment platform, then authenticate an existing Registered Account and call `GET /v1/economy/balance` and `GET /v1/commerce/membership`.
4. Verify the RevenueCat webhook without fabricating a production purchase: use RevenueCat's dashboard test delivery to `POST /v1/commerce/revenuecat/webhook`, then confirm HTTP 200 plus a verified archived delivery in backend operations. Never paste the webhook secret into this document or shell history.
5. With a valid Guest access token and iOS client User-Agent, call `GET /v1/commerce/capabilities`; expect `{"guestCommerceAvailable":false}`.
6. Confirm refund, TRANSFER, and support lookup operational paths remain available while disabled. Use existing sandbox records; do not manufacture production transactions.
7. Set `ENABLE_IOS_GUEST_COMMERCE=true` in the backend runtime configuration and redeploy/restart all API instances consistently.
8. Repeat `GET /v1/commerce/capabilities`; expect `{"guestCommerceAvailable":true}`. Verify new Guest mapping and Purchase Attempt creation in sandbox only.
9. Only after steps 1–8 pass may the human operator distribute build 15 and allow its Guest purchase UI to reach the enabled backend.

Suggested authenticated capability check:

```bash
curl --fail-with-body \
  -H "Authorization: Bearer $GUEST_ACCESS_TOKEN" \
  -H "User-Agent: StitchWish/iOS" \
  "$API_BASE_URL/v1/commerce/capabilities"
```

## 6. Capability rollback

Setting `ENABLE_IOS_GUEST_COMMERCE=false` must stop new Guest RevenueCat subscriber mappings and new Guest Purchase Attempts with HTTP 403. It must keep processing refunds/reversals, RevenueCat `TRANSFER`, existing Purchase Attempt status reads, commerce-promotion recovery, and support lookups. It does not delete existing bindings, attempts, grants, or reversals.

`backend/test/commerce-reversal-and-recovery.integration-spec.ts`, under “Capability disablement blocks new Guest Purchase Attempts but not existing operations,” covers the 403 behavior plus continued refund, TRANSFER, support lookup, and status behavior.

## 7. Version and build

- Marketing version: `1.1`, pinned in `app/app.json`.
- Replacement iOS build: `15`.
- `app/eas.json` sets `cli.appVersionSource` to `remote`; do not change it. The iOS build number lives in EAS remote version state, not this repository.
- From `app/`, a human with authorized EAS access must run `eas build:version:set -p ios`, select the production profile when prompted, and set build number `15`. Then run `eas build:version:get -p ios` and record the returned production iOS build number before starting `eas build --platform ios --profile production`.

This repository can assert version `1.1`; it **cannot assert the EAS remote build number or that build 15 exists**.

## 8. What's New

App Store source language is English (`en`) and is the only currently required localization. Turkish (`tr`) is planned, not shipped; see [`app-metadata.md`](app-metadata.md#languages).

English (`en`), complete text:

> Guest players can now buy Stitch Coin packs, AI Credit packs, and Premium on iPhone without creating an account. Purchases remain recoverable through sign-in, and refund handling keeps balances accurate. We also improved purchase recovery and made Account Deletion easier to find in Settings, with secure reauthentication before a request is created.

Ready-to-use Turkish (`tr`) only if that localization is added:

> Misafir oyuncular artık hesap oluşturmadan iPhone'da Dikiş Parası paketleri, AI Kredi paketleri ve Premium satın alabilir. Satın alımlar giriş yapıldığında korunur ve iade işlemleri bakiyeleri doğru tutar. Ayrıca satın alma kurtarma akışını iyileştirdik ve Hesap Silme seçeneğini Ayarlar'da daha kolay bulunur hâle getirdik; istek oluşturulmadan önce güvenli yeniden kimlik doğrulaması gerekir.

## 9. Replacement submission plan

Use the canonical records in [`store-products.md`](store-products.md); do not create replacements or change identifiers.

| Item | ASC product ID | Change in this submission |
|---|---|---|
| `com.avk.stitchwish.coin_pack_300` | `6795039592` | Submit with version 1.1 build 15; Guest purchase path added on iOS |
| `com.avk.stitchwish.coin_pack_900` | `6795039941` | Submit with version 1.1 build 15; Guest purchase path added on iOS |
| `com.avk.stitchwish.coin_pack_2000` | `6795039791` | Submit with version 1.1 build 15; Guest purchase path added on iOS |
| `com.avk.stitchwish.ai_credit_pack_5` | `6795039860` | Submit with version 1.1 build 15; Guest purchase path added on iOS |
| `com.avk.stitchwish.ai_credit_pack_20` | `6795039890` | Submit with version 1.1 build 15; Guest purchase path added on iOS |
| `com.avk.stitchwish.ai_credit_pack_50` | `6795039687` | Submit with version 1.1 build 15; Guest purchase path added on iOS |
| `com.avk.stitchwish.premium_annual` | `6795040080` | Submit with version 1.1 build 15; Guest purchase path added on iOS; group membership unchanged |
| `com.avk.stitchwish.premium_monthly` | `6795040225` | Submit with version 1.1 build 15; Guest purchase path added on iOS; existing three-day trial remains |
| `com.avk.stitchwish.premium_weekly` | `6795040253` | Submit with version 1.1 build 15; Guest purchase path added on iOS; group membership unchanged |

Guest eligibility is enforced in `backend/src/economy/guest-purchase-attempt.service.ts`: a Guest Purchase Attempt is accepted for the three Stitch Coin packs, the three AI Credit packs, and the three Premium Plans, and refused for anything else. All nine products therefore reach the new Guest path on iOS.

Premium subscription group: `Premium Membership`, ASC group ID `22267302`. A human must confirm all nine remain attached to the replacement version submission and their current ASC state permits submission. This document does not claim that attachment or submission occurred.

## 10. App Review notes

Use these reviewer steps after build 15 is uploaded and verified by a human:

1. Install build 15 fresh on an iPhone and open Stitch Wish. Continue as a Guest Player; do not create an account.
2. Open **Profile**, then **Get Coins & AI Credits**. Select a Stitch Coin pack and confirm the App Store sandbox purchase.
3. Wait for the purchase status to finish. Confirm the Stitch Coin balance increases by the pack amount. AI Credit packs and Premium Plans are purchasable as a Guest on iOS as well and may be exercised the same way.
4. Create or sign in to a Registered Account from the app's sign-in entry. Complete the displayed Guest data promotion flow.
5. Force-close the app, cold launch it, and confirm the same Registered Account remains signed in and the promoted Stitch Coin balance remains visible.
6. Open **Settings**. Confirm the **Account Deletion** action is visible without contacting support or visiting a website.
7. Open **Account Deletion**, read both warnings, and continue. Complete the required same-account reauthentication when prompted.
8. Return to the final Account Deletion confirmation screen. Stop before the final destructive confirmation unless App Review specifically needs to exercise the request on its review account.

## 11. Physical-iPhone recording script

Record one continuous, unedited take on a physical iPhone:

1. Show the installed app version/build in iOS Settings or the authorized build-information surface — expected: version 1.1, build 15.
2. Delete/reinstall or start from a verified fresh Guest state — expected: app opens without mandatory registration.
3. Open Profile → Get Coins & AI Credits — expected: all nine products render with App Store prices and are selectable as a Guest.
4. Buy one Stitch Coin pack with an Apple sandbox tester — expected: native purchase sheet, then in-app verifying state, then one balance increase matching the selected pack.
5. Leave and reopen the commerce screen — expected: granted balance persists and no duplicate grant appears.
6. Sign up or sign in — expected: explicit Guest promotion flow, then Registered Account session with the paid Stitch Coin retained.
7. Force-close and cold launch — expected: Registered Account session and promoted balance remain.
8. Open Settings — expected: Account Deletion is visible.
9. Open Account Deletion and proceed through both warnings — expected: reauthentication is required before request creation.
10. Complete same-account reauthentication — expected: final destructive confirmation appears. Do not submit the deletion request unless the recording account is disposable and the test plan explicitly requires it.
11. End by showing Settings and the retained balance — expected: no crash, duplicate grant, forced sign-out, or hidden deletion action.

## 12. Resolution Center response

> Hello App Review,
>
> We prepared replacement version 1.1 build 15 to address the review feedback. The iOS flow now allows a Guest Player to purchase Stitch Coin packs without first creating an account. The purchase is verified by our backend, survives sign-in through the Guest-to-Account promotion flow, and refund events are handled by the same commerce ledger. AI Credit packs and Premium Plans are available on the same Guest path, and every purchase remains recoverable after signing in.
>
> We also made Account Deletion directly accessible in Settings. Creating an Account Deletion Request requires same-account reauthentication and presents the deletion consequences before the final confirmation.
>
> Reviewer steps are provided in the App Review notes: start as Guest, purchase a Stitch Coin pack, sign in, cold restart, then open Settings and follow Account Deletion through reauthentication to the final confirmation.
>
> This message describes the changes included in the replacement candidate. Please use the attached build and reviewer steps once our submission is made.

Do not send this text until a human has verified that build 15 is attached and the steps match the uploaded binary.

## 13. Outstanding human steps

- [ ] Re-run backend unit, full integration, app, and focused migration/backfill suites immediately before submission; record fresh outputs.
- [ ] Complete the physical-device performance gates in [`release-checklist.md`](release-checklist.md).
- [ ] Verify production migrations, deployment health, webhook test delivery, capability-disabled behavior, then capability-enabled behavior in the order above.
- [ ] Set and verify EAS remote iOS build number 15; this repository cannot verify it.
- [ ] Produce the production iOS build and wait for EAS/App Store Connect processing.
- [ ] Distribute the candidate through TestFlight and perform human smoke testing.
- [ ] Record the single-take physical-iPhone evidence sequence.
- [ ] Verify English What's New and App Review notes in App Store Connect; add Turkish text only if `tr` localization is created.
- [ ] Attach all six consumables, all three subscriptions, and Premium group to the replacement version as required by App Store Connect.
- [ ] Confirm App Privacy, agreements, product states, screenshots, metadata, and review contact fields in App Store Connect.
- [ ] Submit version 1.1 build 15 and the nine products for review.
- [ ] Send the Resolution Center response only after the uploaded build and notes are verified.
- [ ] Monitor review. Record the actual outcome; do not assume acceptance.
- [ ] Close issue #115 only after its evidence-backed acceptance criteria are met and closure is explicitly authorized.
