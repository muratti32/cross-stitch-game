# App Metadata

Canonical identity and store metadata for the game. Values marked **locked** must never change after the first store publication.

## Identity

| Field | Value | Notes |
|---|---|---|
| Brand / app name | Stitch Wish | Verified against Appfigures on 2026-07-13: no existing "Stitch Wish" app on Apple or Google storefronts |
| App Store title | `Stitch Wish: Cross Stitch` | 25 chars, within the 30-char limit; carries the primary ASO keyword |
| Google Play title | `Stitch Wish: Cross Stitch` | Same, within the 30-char limit |
| iOS subtitle | `Relaxing cross stitch art` | 25 chars, within the 30-char limit |
| iOS bundle identifier | `com.avk.stitchwish` | **locked** — same `com.avk` organization prefix as CrossCraft (`com.avk.stitch`) |
| Android package name | `com.avk.stitchwish` | **locked** |
| Expo slug | `stitch-wish` | EAS project name |
| Deep link scheme | `stitchwish` | Used by Expo Router linking and Catalog Share Links |
| Version | `1.0.0` | iOS `buildNumber` and Android `versionCode` start at `1` |

## Store listing

| Field | Value |
|---|---|
| Apple primary category | Games › Puzzle |
| Apple secondary category | Games › Casual |
| Google Play category | Games › Puzzle |
| Age rating | Determined by the store rating questionnaires; the app itself has no age gate (deliberate, see memory/no-age-gate decision) |
| Copyright | AVK |
| Support contact | muratti32@gmail.com |

## Platform targets

| Field | Value | Notes |
|---|---|---|
| Framework | Expo (dev client + EAS), Expo Router, `@shopify/react-native-skia` | ADR-0034 |
| iOS minimum | iOS 15.1 | Expo SDK 54 default |
| Android minimum | `minSdkVersion 24` (Android 7.0) | Expo SDK 54 default |
| Orientation | Portrait | Grid navigation uses pinch-zoom and pan; portrait is the primary layout, tablets supported in portrait |

## Languages

| Field | Value | Notes |
|---|---|---|
| App UI source language | English (`en`) | First release ships English; Turkish (`tr`) is the first planned localization |
| Catalog content | Per-submission `Catalog Source Language` | See CONTEXT.md |

## Third-party services (per ADRs)

| Service | Role | ADR | Account-level IDs |
|---|---|---|---|
| RevenueCat | Store purchase verification into the Commerce Ledger | 0032 | RC project + API keys created at commerce setup |
| Google AdMob | Rewarded Ads with Server-Side Verification | 0033 | AdMob app IDs + ad unit IDs created at ads setup |
| Sentry | Crash and performance monitoring | 0035 | DSN created at observability setup |
| fal.ai | AI Artwork generation (`fal-ai/flux-2/turbo`) | 0003 | Server-side key only; never shipped in the client |

Account-level IDs above are provisioned when each integration is set up and recorded here at that time; they are intentionally not invented in advance.

## Privacy posture

- No third-party analytics SDK; first-party pseudonymous gameplay events only (ADR-0035).
- No App Tracking Transparency prompt — no cross-app tracking occurs (ADR-0035).
- Data-subject access requests served through support tooling (ADR-0036).
