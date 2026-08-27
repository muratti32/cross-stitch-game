# App Metadata

Canonical inventory of app identity, platform targets, and external service
provisioning. Cross-check `CONTEXT.md` and `docs/adr/` for the product and
architecture decisions behind these choices. Only confirmed public
identifiers and secret-manager *reference names* belong here — never secret
values.

> **Coverage status:** this file is incomplete. It currently documents app
> identity and the Sentry integration only. Store listing, supported
> languages, RevenueCat, Firebase/auth, push, backend/infrastructure hosting,
> and privacy posture are **not yet inventoried here** — absence of a service
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

## External services

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
