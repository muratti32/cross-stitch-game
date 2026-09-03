# App Metadata

Canonical inventory of app identity, platform targets, and external service
provisioning. Cross-check `CONTEXT.md` and `docs/adr/` for the product and
architecture decisions behind these choices. Only confirmed public
identifiers and secret-manager *reference names* belong here — never secret
values.

> **Coverage status:** this file is incomplete. It currently documents app
> identity, App Display Languages, the Sentry integration, and the Firebase
> Analytics integration with its store privacy declarations. Store listing,
> RevenueCat, Firebase/auth, push, and backend/infrastructure hosting are
> **not yet inventoried here** — absence of a service
> below means "not documented yet", never "not provisioned". Extend this file
> as each area is confirmed.

## App identity

| Field | Value | Source |
| --- | --- | --- |
| Display name | Stitch Wish | `app/app.json` (`expo.name`) |
| Slug | `stitch-wish` | `app/app.json` (`expo.slug`) |
| iOS bundle identifier | `com.avk.stitchwish` | `app/app.json` (`expo.ios.bundleIdentifier`) |
| Apple Team ID | `X25YH9627H` | `app/app.json` (`expo.ios.appleTeamId`) |
| Android package | `com.avk.stitchwish` | `app/app.json` (`expo.android.package`) |
| EAS project ID | `e84c5981-5ec9-4f27-892b-e801f6efb845` | `app/app.json` (`expo.extra.eas.projectId`) |
| EAS owner | `muratti32` | `app/app.json` (`expo.owner`) |

Native projects (`app/ios/`, `app/android/`) are **not** checked into git
(`app/.gitignore`) — this is a Continuous Native Generation (CNG) project.
Every EAS build regenerates them from `app/app.json` + config plugins via
`expo prebuild`, so the config plugin options in `app.json` are the actual
source of truth for native build configuration (not anything hand-edited
under `ios/`/`android/`, which is scratch output).

## App Display Languages

| Status | Languages |
| --- | --- |
| Currently bundled | English (`en`), Turkish (`tr`) |
| Approved next release cohort | Spanish (`es`), German (`de`), French (`fr`), Brazilian Portuguese (`pt-BR`), Italian (`it`) |

The approved cohort expands the mobile interface from two to seven bundled
languages. Store-listing localization is a later, separate phase. App Display
Language scope follows `CONTEXT.md` and ADR-0051; locale identity and fallback
follow ADR-0052.

The next cohort must declare all seven languages to the generated iOS and
Android projects, support both the OS app-language setting and the existing
in-app selector, show every language using its own name, and localize native
permission copy. `Stitch Wish` remains the untranslated brand and display
name.

The later store-localization phase owns App Store and Google Play listing
copy, in-app-purchase and subscription names and descriptions, and
subscription-group localization. Until that phase, store-controlled purchase
copy may remain English even while app-owned commerce UI uses the selected App
Display Language.

## External services

### Firebase Analytics (product analytics) — see ADR-0055

| Field | Value |
| --- | --- |
| Firebase project id | `stitchwish-d3b28` (same project as the ADR-0038 auth broker; one project serves every environment) |
| Packages | `@react-native-firebase/app`, `@react-native-firebase/analytics` |
| Config plugin | `@react-native-firebase/app`, registered by `app/app.config.ts` **only when both Google service files are present** |
| Service files | `app/credentials/firebase/google-services.json`, `app/credentials/firebase/GoogleService-Info.plist` — client-side identifiers, not secrets; absent from a fresh clone, which then builds with no Analytics |
| Collection default | Disabled. Enabled only after the ADR-0033 UMP consent flow reports consent granted |
| Development builds | Disabled unless `EXPO_PUBLIC_FIREBASE_ANALYTICS_ENABLED=true` on that device (DebugView verification only) |
| Identity sent | The opaque player reference (Registered Account id or Guest Installation Identity), the same one Sentry receives. Never an email address, Firebase UID, or auth-provider subject |
| User properties | `is_guest`, `app_language`, `membership_tier` |
| Data retention | Two months (console default) |
| Tracking | No advertising identifier, no App Tracking Transparency prompt, no cross-app tracking |

**Required manual setup (console-side, not performed by this repo's code):**

- Register an iOS app (bundle identifier) and an Android app (package name plus
  debug and release SHA-1/SHA-256 signing fingerprints) in the Firebase project,
  then download both service files into `app/credentials/firebase/`.
- Extend the UMP consent message to cover the analytics purpose, so consent has
  a correct legal basis without adding in-app copy.
- Confirm Analytics data retention is left at two months.

### Store privacy declarations

| Surface | Declaration |
| --- | --- |
| App Store privacy labels | Add **Analytics → Product Interaction, Other Usage Data** and **Identifiers → User ID** (the opaque player reference), both "Not used to track you". Tracking stays declared as **No** |
| Play Data safety | Add **App activity → App interactions** and **App info and performance**, collected, not shared, consent-based, deletable via the existing account deletion flow |

Drafts only — submitting updated store metadata remains a human action.

### Sentry (crash reporting + performance) — see ADR-0035

| Field | Value |
| --- | --- |
| Organization slug | `avk-corp` |
| Project slug | `stitch-wish` |
| Config plugin | `@sentry/react-native/expo` in `app/app.json` (`expo.plugins`) |
| Auth mechanism | `SENTRY_AUTH_TOKEN` environment variable, injected at EAS build time — never written to a file in this repo |

Native symbol/mapping upload wiring (as of the `experimental_android` block
added to the plugin config in `app/app.json`):

- **iOS dSYMs**: uploaded via the "Upload Debug Symbols to Sentry" Xcode
  build phase (`sentry-xcode-debug-files.sh`), added unconditionally by the
  config plugin to every regenerated `ios/` project.
- **Android JS sourcemaps**: uploaded via the legacy `sentry.gradle` script
  (`@sentry/react-native/sentry.gradle`), applied unconditionally.
- **Android native (NDK) debug symbols and Proguard/R8 mapping**: uploaded via
  the Sentry Android Gradle Plugin (`io.sentry.android.gradle`), which is only
  wired into `android/app/build.gradle` when the config plugin is passed
  `experimental_android.enableAndroidGradlePlugin: true`.

**Required manual setup (not done by this repo's code — no token is or should
be committed):**

Set `SENTRY_AUTH_TOKEN` as an EAS environment variable (Sentry auth token
with project:releases scope, generated from the `avk-corp` Sentry org) for
every environment EAS builds run against:

```
eas env:create --scope project --name SENTRY_AUTH_TOKEN --type secret \
  --environment development --visibility sensitive
eas env:create --scope project --name SENTRY_AUTH_TOKEN --type secret \
  --environment preview --visibility sensitive
eas env:create --scope project --name SENTRY_AUTH_TOKEN --type secret \
  --environment production --visibility sensitive
```

(`app/eas.json` build profiles already declare `"environment": "preview"` /
`"production"` / `"development"`, so EAS auto-injects whichever variables are
scoped to that environment during the native build — no `eas.json` change is
needed to wire the token through.) Without this variable set, the Sentry
build-time upload steps above run but silently produce no symbols/mapping on
the server, which is the root cause behind the fragmented/`<redacted>`
Sentry issues tracked in #143–#146, #149, #150.
