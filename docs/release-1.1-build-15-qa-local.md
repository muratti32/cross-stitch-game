# Local QA — 1.1 build 15 rejection fixes

Manual QA directives for the three App Review findings on submission
`58c46267-d655-4b82-aacc-85ab6e42d92f`, fixed in commit `bcf0bb8`.

Every scenario below is written so it **fails on build 14 and passes on the
fix**. If a scenario passes before you apply the fix, the scenario is wrong —
stop and re-read it rather than declaring the bug gone.

This covers the rejection fixes only. It does **not** replace the Stitch
Interaction Budget gate in [`release-checklist.md`](release-checklist.md),
which still requires physical reference hardware.

---

## 0. Setup

### 0.1 Backend

```bash
cd backend
npm run start:all:dev    # api + worker
```

Run **both** processes, not `start:dev` alone. Purchase verification and
reconciliation depend on the worker; with the API only, a purchase appears to
succeed on device and then never reconciles, which looks like a product bug and
is not one.

Guest commerce is behind a server flag. Confirm it is on before touching the
app, or every Guest purchase path will refuse and you will QA the wrong thing:

- `ENABLE_IOS_GUEST_COMMERCE=true` in the backend env
  (read at `backend/src/config/app-config.service.ts:175`)

### 0.2 App

```bash
cd app
# .env must point at the backend you just started
#   EXPO_PUBLIC_API_BASE_URL=http://<your-lan-ip>:3000
npm run ios          # npx expo run:ios --device
```

**Use a physical iOS device, not the simulator.** Guest purchases are gated on
`Platform.OS === 'ios'` and go through real StoreKit via RevenueCat. Two ways
to transact:

| Mode | `.env` | Notes |
|---|---|---|
| Sandbox (closest to review) | `EXPO_PUBLIC_REVENUECAT_STORE_MODE=native` + `EXPO_PUBLIC_REVENUECAT_API_KEY_IOS` | Sign the *device* into a Sandbox Apple ID (Settings → Developer → Sandbox Apple Account). Do **not** sign the App Store into it. |
| RevenueCat Test Store | `EXPO_PUBLIC_REVENUECAT_STORE_MODE=test_store` + `EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY` | Faster loop, no Apple sandbox. Use for flow/UI checks; do at least one full pass in sandbox before resubmitting. |

Validation lives at `app/src/commerce/revenueCat.ts:62-100` — a wrong mode or a
key with the wrong prefix surfaces as "Commerce is unavailable", which is a
config error, not a bug in the flow.

### 0.3 Start from a clean install every time

App Review installs fresh. A leftover session envelope hides exactly the bug
that got us rejected. **Delete the app from the device before each scenario
below** — do not just relaunch. The Guest identity lives in SecureStore and
survives a relaunch.

---

## 1. Guideline 2.1(a) — sign-in unreachable behind the pack sheet

This is the reviewer's exact path. Walk it verbatim.

1. Fresh install. Do not sign in. Stay a Guest.
2. Profile tab → open the Commerce Store.
3. Tap **Stitch Coin Packs**. The pack sheet slides up.
4. Tap **Buy** on any pack. The Guest Data Risk Notice appears.
5. Tap **Sign in instead**.

**Pass:** the pack sheet is gone and the sign-in screen is fully visible and
interactive — you can type an email and tap Send code.

**Fail (build 14 behaviour):** the sign-in screen renders dimmed *behind* the
still-present pack sheet and cannot be reached. This is what
`Screenshot-0821-134821.png` in
`.asc/web-review/6792383323/58c46267-d655-4b82-aacc-85ab6e42d92f/` shows.

6. Complete sign-in (email code is fine).
7. Go to the **Settings** tab.

**Pass:** Account shows your email and a **Sign out** control.

**Fail:** Account still reads "Not signed in" and asks you to sign in again —
the literal rejection text.

Repeat steps 2-5 once via **AI Credit Packs** instead of Stitch Coin Packs.

---

## 2. Guideline 5.1.1(v) — purchasing without registration

Run each of these as a Guest on a fresh install. **At no point may you be
required to create an account.** Sign-in may be *offered*; it may never be the
only way forward.

### 2.1 Premium plan

1. Fresh install, stay a Guest. Commerce Store.
2. Read the Premium plan button.
   - **Pass:** "Choose Annual".
   - **Fail:** "Sign in for Annual" (build 14 wording — this is what App Review
     read as a registration requirement).
3. Tap it → Guest Data Risk Notice → **Continue as Guest**.
4. Confirm in the Premium confirmation sheet and complete the StoreKit purchase.

**Pass:** the purchase completes and Premium becomes active while still a
Guest. Verify a Premium-only benefit actually unlocks — Settings → Theme
Collection → select **Rose Garden** (locked for non-Premium).

### 2.2 Stitch Coin pack

Buy a pack as a Guest. The coin count in the store header must increase by the
pack amount.

### 2.3 AI Credit pack — the wallet fix

1. Fresh install, stay a Guest. Note the sparkles (AI Credit) value in the
   store header — it reads 0.
2. Buy **5 AI Credits**.

**Pass:** the sparkles value shows **5**.

**Fail (build 14 behaviour):** it stays **0** forever. The credits existed
server-side and were spendable, but the wallet hardcoded 0 for Guests — a
"I paid and nothing happened" bug, and a second 2.1(a) exposure.

3. Confirm the credits are real: go create an AI Artwork and watch the balance
   decrease.

### 2.4 Restore as a Guest

With an active Guest Premium, delete and reinstall the app, then tap **Restore
Guest Premium** in the store.

**Pass:** Premium is restored without signing in.

---

## 3. Guideline 5.1.1(v) — account deletion is reachable

The deletion UI is correctly account-only (`isAccount`, `app/app/(tabs)/(settings)/index.tsx:465`).
The reviewer never saw it because they could never get signed in — so QA the
path they were blocked on.

1. Fresh install → sign in (any provider).
2. Settings tab → scroll to the **Account Deletion** section.

**Pass:** a red **Delete Account** row is visible, described as permanent after
a 30-day recovery window.

3. Tap it and walk both confirmation stages, including the reauthentication
   prompt, through to submission.

**Pass:** you get "Account Deletion Requested" with a recovery window date, and
the section then shows **Account Deletion Pending** with **Cancel deletion**.

4. Sign back in and cancel the deletion. It must succeed.

The whole flow must be in-app. If any step sends you to a website, that is a
finding — Apple called out website-only deletion explicitly.

---

## 4. Regression checks

The fix touches shared navigation and CTA state. Confirm these still work.

| Check | Expected |
|---|---|
| Sign-in return intent | As a Guest, open a pack sheet → Buy → **Sign in instead** → complete sign-in. You land back on the store with a "You're signed in… still selected" notice and the pack marked **Selected before sign-in**. |
| Signed-in purchase | As a signed-in account, buy a coin pack and a Premium plan. The Guest Data Risk Notice must **not** appear. |
| Account restore | As a signed-in account, **Restore purchases** still runs the account path (not the Guest path). |
| Overlay dismissal | The pack sheet's X and backdrop tap still close it without navigating anywhere. |
| Android | Guest purchase attempts surface "Guest purchases are available on iOS only" rather than crashing or silently failing. |

---

## 5. Automated gates (run before every resubmission)

```bash
cd app
npx tsc --noEmit          # expect: No errors found
npm test -- --runInBand   # expect: 45 suites / 360 tests passed
```

```bash
cd backend
npm test
npm run test:integration  # needs a Docker-compatible runtime
```

The three rejection fixes each carry a regression test in
`app/src/commerce/__tests__/CommerceStoreScreen.test.tsx`:

- "closes the pack sheet before routing a Guest to sign-in so the destination is reachable"
- "lets a Guest purchase Premium end-to-end without ever requiring registration"
- "shows a Guest their real AI Credit wallet balance instead of a hardcoded 0"

Green tests are necessary, not sufficient. They mock StoreKit, so they cannot
catch a native modal-presentation regression or a real purchase failure. §1-§3
on a device are the actual gate.

---

## 6. Sign-off

Do not attach the build to the review submission until every box is true:

- [ ] §1 passes on a physical iOS device, both pack categories
- [ ] §2.1-§2.4 pass as a Guest with no account created at any point
- [ ] §2.3 shows a non-zero AI Credit wallet after purchase
- [ ] §3 completes in-app, including reauthentication and cancellation
- [ ] §4 shows no regression
- [ ] §5 green
- [ ] At least one full pass done in Apple **sandbox** mode, not only Test Store
- [ ] Reply drafted at [`release-1.1-build-15-review-reply.md`](release-1.1-build-15-review-reply.md) reviewed and its "build 15" claim made true
