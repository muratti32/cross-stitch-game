# App Review reply draft — 1.1 build 15

**Status: DRAFT. Not sent.** The developer sends this manually.

- App: Stitch Wish: Cross Stitch (`6792383323`, `com.avk.stitchwish`)
- Rejected submission: `58c46267-d655-4b82-aacc-85ab6e42d92f`
- Version reviewed: 1.1 (14), reviewed 21 August 2026 on iPhone 17 Pro Max / iOS 26.6
- Rejection thread: `abbf0315-84ee-34d5-9cd4-d6ea7badd738`
- Fixes commit: `bcf0bb8` — *fix(app): unblock guest purchases rejected in App Review*

Send only after build 15 is uploaded and attached to the version, so the
"submitted with this reply" sentence is true. If the reply goes first, delete
that closing line.

## Reply text

Thank you for the detailed review.

**Guideline 2.1(a) — login loop after tapping Settings.** We reproduced this. When a Guest tapped a Stitch Coin pack and chose "Sign in instead", the app navigated to the sign-in screen while the product sheet's modal was still presented, so the sign-in screen rendered behind it and could never be completed. Tapping Settings then correctly still showed a signed-out state. We now dismiss every commerce overlay before navigating to sign-in, and added a regression test that fails without the fix.

**Guideline 5.1.1(v) — registration required for non-account-based purchases.** All Stitch Coin packs, AI Credit packs, and Premium plans can now be purchased as a Guest, with no registration at any point. A Premium plan's button previously read "Sign in for Annual"; it now reads "Choose Annual" and completes as a Guest. Signing in is offered only as an optional way to access purchases on other devices, and purchases can be restored as a Guest as well. We also fixed the wallet, which previously displayed a Guest's AI Credit balance as 0 even after a successful purchase.

**Guideline 5.1.1(v) — account deletion.** In-app account deletion is available at Settings → Account Deletion → Delete Account, which is visible once signed in. Because of the sign-in bug above, the reviewer was never able to reach a signed-in state, which is why this option was not visible. The flow is entirely in-app, requires reauthentication, and schedules permanent deletion after a 30-day recovery window; no website visit is required.

These changes are in build 15, submitted with this reply.

## Verification behind these claims

| Claim | Evidence |
|---|---|
| Overlay/sign-in fix | `app/app/(tabs)/(profile)/commerce.tsx` — `closeCommerceOverlays()` called before both sign-in navigations (lines ~865, ~1361) |
| Regression test | `CommerceStoreScreen.test.tsx` — "closes the pack sheet before routing a Guest to sign-in…"; fails pre-fix with `Expected: 0, Received: 1` |
| Guest Premium purchase | CTA now `Choose {plan}`; test "lets a Guest purchase Premium end-to-end without ever requiring registration" (fails pre-fix: `Missing text: Choose Annual`) |
| Guest restore | Pre-existing test "restores a Guest Player Premium entitlement without restoring consumables" |
| Guest AI Credit wallet | `commerce.tsx:1029` now `aiCreditBalance ?? 0`; backend `commerce-ledger.repository.ts:316` reads `'account' \| 'guest'` alike |
| Account deletion in-app | `app/app/(tabs)/(settings)/index.tsx:499` "Delete Account", 30-day recovery window, reauthentication required |
| Suite | `npx tsc --noEmit` clean; `npm test -- --runInBand` → 45 suites / 360 tests passed |

## How to send

`asc` cannot post this. `asc web review` only offers `list`, `show`,
`subscriptions`, and `iaps` — there is no reply subcommand, and the public API
does not expose Resolution Center writes either.

Paste the reply text above (that section only) into App Store Connect →
Resolution Center:

<https://appstoreconnect.apple.com/apps/6792383323/appstore/review>

After sending, re-run this to confirm the thread state moved:

```
ASC_TIMEOUT=120s asc web review show --app 6792383323 --apple-id "muratulug2@gmail.com"
```
