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
| Privacy Policy URL | https://stitchwish.avkdesign.net/privacy-policy |

## Platform targets

| Field | Value | Notes |
|---|---|---|
| Framework | Expo (dev client + EAS), Expo Router, `@shopify/react-native-skia` | ADR-0034 |
| iOS minimum | iOS 16.4 | Expo SDK 57 default |
| Android minimum | `minSdkVersion 24` (Android 7.0) | Expo SDK 57 default; compiles and targets Android API 36 |
| Orientation | Portrait | Grid navigation uses pinch-zoom and pan; portrait is the primary layout, tablets supported in portrait |

## Languages

| Field | Value | Notes |
|---|---|---|
| App UI source language | English (`en`) | First release ships English; Turkish (`tr`) is the first planned localization |
| Catalog content | Per-submission `Catalog Source Language` | See CONTEXT.md |

## Service stack

Service statuses have the following meanings:

- **Decided**: required by an accepted ADR.
- **Required**: mandated by the target platform or the accepted product scope; the provider is inherent in the capability.
- **Recommended**: the current first-release provider recommendation; confirm and provision it before implementation.
- **Required / TBD**: the capability is required, but its provider has not been selected.
- **Deferred**: do not add it to the first release without a new product or architecture decision.

### External platforms and SaaS

| Capability | Service | Status | Scope and boundary | Configuration to record |
|---|---|---|---|---|
| In-app purchase catalog (both stores) | App Store Connect + Google Play Console | **Provisioned** on both stores and in RevenueCat 2026-07-27 | The nine real-money products, their identifiers, prices, localizations, subscription group, and trial. Identifiers are reverse-DNS and shared across Apple, Play, RevenueCat, and the backend grant catalog (ADR-0043). | Full matrix in [`docs/store-products.md`](store-products.md) — App Store app ID `6792383323`, subscription group `22267302`, per-product Apple IDs |
| Mobile build and submission | Expo Application Services (EAS) | **Decided** (ADR-0034) | Development, preview, and production builds; signing and store submission. | Expo organization, project ID, project owner, build-profile names |
| Apple distribution, auth, and optional push transport | Apple Developer + App Store Connect | **Required** | App distribution, Sign in with Apple, IAP products, and APNs credentials if push is enabled. | Team ID, App Store app ID, issuer/key IDs, Sign in with Apple configuration, APNs key ID, private-key secret references |
| Google distribution and authentication | Google Play Console + Google Cloud OAuth | **Required** | Play distribution, IAP products, and native Google Sign-In. Google credentials are exchanged through Firebase Authentication, but Google and Firebase are not account or session sources of truth. | Cloud project ID/number, web/server OAuth client ID, iOS client ID and reversed-client scheme, Android client IDs and SHA-1/SHA-256 per build environment, Play app ID |
| Federated identity verification | Firebase Authentication | **Decided** (ADR-0038) | Identity broker for Google and Apple only. The client keeps Firebase Auth in memory, sends a fresh Firebase ID token to the Game Backend, and signs out of Firebase. The backend verifies it with Firebase Admin, resolves the provider-specific subject, and issues game-owned tokens. Firebase UID and email never become Registered Account identifiers. | Separate Firebase project IDs per environment, public web-app config, enabled Google/Apple providers, OAuth client IDs, backend service-account secret reference, vendor retention/deletion owner |
| Transactional email | [Resend](https://resend.com/docs/dashboard/domains/introduction) | **Required** capability; Resend **recommended** | Deliver the six-digit Email Sign-In code and required Moderation Notice email. The Game Backend creates the code, stores only a keyed verifier, owns expiry/attempt/rate limits, and sends through an idempotent email outbox; Resend is delivery only. Disable open/click tracking. | Team ID, verified sending subdomain, From/Reply-To addresses, template IDs, webhook endpoint, API-key and signing-secret references |
| Store purchase event normalization | RevenueCat | **Provisioned** 2026-07-27 (ADR-0032); store credentials, prices, and webhook still pending | Verified store input into the game-owned Commerce Ledger; never the balance or entitlement source of truth. | Project `projf2795a83`, apps `app5adf5224e0` (iOS) / `app9943323f25` (Android), entitlement `entl57a71f4adf` (`premium`), offering `ofrng489e2fe72c` (`default`); see [`docs/store-products.md`](store-products.md). Public SDK keys, webhook endpoint, and secret references still to be added |
| Rewarded advertising and consent | Google AdMob + Google UMP | **Decided** (ADR-0033); UMP GDPR/EEA-UK message **published** 2026-07-21 | Player-started Rewarded Ads only, with Server-Side Verification. First release uses non-personalized/no-IDFA delivery so it performs no cross-app tracking and requests no ATT permission. No banners, interstitials, or ad-funded AI Credit. | App IDs: Android `ca-app-pub-0493573291885691~2187247429`, iOS `ca-app-pub-0493573291885691~6805149283` (both apps currently "Requires review" / limited ad serving in AdMob until a store listing is linked). GDPR/EEA-UK message "Stitch Wish - European regulations (GDPR/EEA-UK)" is published in AdMob Privacy & messaging, scoped to both apps, with an equally-prominent "Do not consent" button enabled for all EEA/UK/Switzerland countries. Still needed: SSV callback URL, ad unit IDs, US states message, IDFA explainer scoping, and UMP SDK integration in app code (Ad unit deployment is currently off for these apps, so the client must call the UMP SDK directly to gate ad requests until consent is obtained) plus wiring the ad request to non-personalized (`npa=1`) per ADR-0033 — none of this is configurable from the AdMob console. |
| AI artwork generation | fal.ai | **Decided** (ADR-0003) | `fal-ai/flux-2/turbo`, queue/webhook delivery, provider safety check, and backend reconciliation. | Account/application ID, model version, webhook endpoint, server-side secret reference |
| Text and image safety signals | [OpenAI Moderation](https://developers.openai.com/api/docs/guides/moderation) | **Decided** (ADRs 0003 and 0019) | `omni-moderation-latest` for AI prompts and Catalog Precheck text/image signals. Automated profile-avatar safety is also required; reusing this provider is recommended. Automated signals never publish or finally reject catalog content. | Project ID, model name, server-side secret reference, data-control/retention status, rate and cost alerts |
| Client crash and performance telemetry | Sentry | **Decided** (ADR-0035); **provisioned** 2026-07-20 | Crash reporting and the ADR-0031 interaction-performance release gate. Prompts, artwork, Pattern bytes, email, and provider identifiers must be scrubbed. | Organization: `avk-corp` (region `https://de.sentry.io`, not shared with CrossCraft's separate `crosscraft` project). Project: `stitch-wish`. DSN is a public client key, wired via `EXPO_PUBLIC_SENTRY_DSN`. Environment (`development`/`preview`/`production`) is split by the `EXPO_PUBLIC_SENTRY_ENVIRONMENT` tag rather than separate projects. Source-map upload auth token secret-manager reference name: `SENTRY_AUTH_TOKEN` (EAS environment variable, not yet provisioned — see provisioning checklist). Alert owners not yet assigned. |
| DNS, legal/support site, and Catalog Share Link fallback | Cloudflare DNS + Pages/Workers | **Recommended** | Branded domain, Universal Links/App Links, Privacy Policy, Terms, and Support pages. Share pages must resolve current catalog availability through Pages Functions/Workers or the Game Backend and support preview purge after Review Hold, Catalog Withdrawal, or Safety Removal; they are not permanently static snapshots. Do not enable third-party web analytics by default. | Account/zone/project IDs, production domains, association-file routes, state/purge endpoint, deploy owner |
| Pattern and artwork object storage | [Cloudflare R2](https://developers.cloudflare.com/r2/get-started/s3/) | **Recommended** | S3-compatible private origin for Pattern Artifacts and private artwork plus public CDN delivery for eligible Pattern Previews, as required by ADR-0018. | Account ID, bucket names per environment/data class, public hostname, lifecycle rules, scoped key references |
| User support inbox | Branded mailbox or forwarding provider | **Required / TBD** | Receives support and data-access requests. Resend is the outbound transactional channel, not the support ticket source of truth. The existing Gmail address may be a development destination, but launch requires a branded address with MFA, named access owners, retention, and escalation rules. Data-export archives are delivered through a controlled channel, not retained as ordinary mailbox attachments. | Public address, support URL, routing owner, retention policy, escalation path |

Secrets and private keys must never be written in this file. Record only public identifiers and secret-manager reference names after provisioning.

### Game-owned infrastructure

| Capability | Required contract | Provider status |
|---|---|---|
| Backend runtime | Independently deployable NestJS API, Job Outbox dispatcher, webhook endpoints, scheduled reconciliation jobs, and workers; must support long-running processes rather than short-lived functions only. | **Required / TBD** |
| PostgreSQL | Durable source of truth for accounts, content, progress, economy, moderation, Processing Jobs, and first-party events; managed backups, point-in-time recovery, TLS, pooling, and tested restores are required. | **Required / TBD** |
| Redis and BullMQ | At-least-once Processing Queue transport with TLS, controlled eviction, queue-depth metrics, retries, and dead-letter/operator recovery. PostgreSQL remains the source of truth after Redis loss. | **Required / TBD** (technology decided by ADR-0013) |
| Conversion compute | Independently scalable Python Conversion Engine workers with temporary disk/memory suitable for image quantization and no retained Local Photo Source. | **Required / TBD** |
| Operator console | Game-owned, MFA- and RBAC-protected tooling for catalog/profile moderation, appeals, reports, Support Reference lookup, promotion recovery, account deletion, and data exports; all actions need an audit trail. | **Decided** (ADR-0039) — game-owned Next.js console over an in-process `/admin` API; implemented v1 slices are Official Pattern management and Support Reference lookup |
| Backend operations | Central logs, uptime checks, API/worker health, PostgreSQL/Redis health, queue backlog, webhook failures, stuck Processing Jobs, and `Promotion Needs Attention` alerts. | **Required / TBD** |
| Secrets and key management | Environment-scoped encrypted storage for provider API keys, OAuth/APNs keys, database credentials, and webhook signing secrets, with least privilege, access audit, and rotation procedures. Use the hosting provider's managed secret store or a dedicated KMS/secret manager. | **Required / TBD** |
| Product analytics | Pseudonymous first-party event schema stored and queried beside Game Backend domain data; no third-party product-analytics SDK. | **Decided** (ADR-0035) |

### Firebase, push, and OneSignal boundary

- Firebase Authentication is part of the first-release stack only as the Google/Apple identity broker defined by ADR-0038. Firebase UID, Firebase sessions, and email matching never authorize Game Backend data or identify a Registered Account.
- Firestore, Realtime Database, Firebase Storage, Analytics, Crashlytics, and Dynamic Links remain outside the first-release stack because they would duplicate the Game Backend/PostgreSQL authority, S3-compatible storage, first-party analytics, Sentry, or branded Catalog Share Links.
- Firebase Cloud Messaging is not enabled by ADR-0038. The Firebase project may provide FCM v1 credentials only after a separate push-notification decision.
- There is no mandatory push-notification flow in the accepted first-release domain. Email and durable in-app records remain the required delivery channels for moderation notices.
- If transactional push is added, start with [`expo-notifications` and Expo Push Service](https://docs.expo.dev/push-notifications/overview/) because the client already uses Expo. Push is a best-effort convenience signal, never the source of a moderation, commerce, progress, or deletion state; the backend must process push tickets/receipts and remove invalid tokens.
- OneSignal is **deferred**. Reconsider it only when there is an explicit need for campaign authoring, segmentation, or multi-channel orchestration that Expo Push Service cannot satisfy. If adopted later, its analytics, location, email, SMS, and in-app campaign features stay disabled unless separately approved, and only opaque Game Backend identifiers may be used.
- Do not use Firebase Dynamic Links. Catalog Share Links use the game's own HTTPS domain with Universal Links/App Links and a web fallback (ADR-0022).

### Provisioning checklist

- [ ] Acquire the branded domain and configure DNS, Privacy Policy, Terms/EULA, Support, and Catalog Share Link routes.
- [ ] Create separate development/staging and production resources wherever a provider supports them; never share CrossCraft projects, databases, buckets, queues, or credentials.
- [ ] Provision Resend, verify a dedicated sending subdomain with its SPF/DKIM records, publish a DMARC policy, define OTP and moderation templates, and configure idempotent bounce/complaint webhooks.
- [ ] Create Apple and Google authentication credentials with the exact locked bundle/package identifiers and configure allowed redirects/audiences.
- [ ] Create separate non-production and production Firebase projects, register the locked iOS/Android identifiers, enable only Google and Apple Auth providers, configure Apple private-email relay, store the Firebase Admin service account in the backend secret manager, and record the public client configuration in EAS environments.
- [ ] Select the backend host, managed PostgreSQL provider, and managed Redis provider; document regions, backup/PITR policy, restore test, connection limits, and cost alerts.
- [ ] Create separate object-storage buckets or prefixes for temporary Conversion Uploads, private AI Artwork and Personal Pattern Previews, immutable Pattern Artifacts, public catalog previews, and moderation evidence; apply least-privilege keys and data-specific lifecycle rules. Never retain the full-resolution Local Photo Source.
- [ ] Provision RevenueCat products/webhooks, AdMob rewarded units/SSV/UMP, fal.ai webhooks, OpenAI moderation, and Sentry projects for non-production and production environments. Sentry: `avk-corp/stitch-wish` project and client DSN are provisioned; still need the `SENTRY_AUTH_TOKEN` EAS secret, `EXPO_PUBLIC_SENTRY_DSN`/`EXPO_PUBLIC_SENTRY_ENVIRONMENT` EAS environment variables for the `preview` and `production` profiles, and assigned alert owners. AdMob: GDPR/EEA-UK UMP consent message is published for both apps (2026-07-21); still need the SSV callback, rewarded ad units, US states message, and UMP SDK wired into the app code.
- [ ] Deploy the operator console and backend data-export/support tools before enabling Catalog Submission or public creator profiles.
- [ ] Add webhook signature verification, idempotency, replay handling, secret rotation, uptime alerts, and runbooks for every external callback.
- [ ] Update App Store privacy details, Google Play Data safety, the Privacy Policy, and the vendor deletion/retention register after the final providers are provisioned.

For every provisioned service, record its environment, public account/project IDs, region, public endpoint/domain, secret-reference names, data classes and retention, backup policy, operational owner, budget alert, and last verification date.

## Privacy posture

- No third-party analytics SDK; first-party pseudonymous gameplay events only (ADR-0035).
- No App Tracking Transparency prompt — no cross-app tracking occurs (ADR-0035).
- Resend receives only the destination email address and minimum transactional content required for Email Sign-In and Moderation Notice delivery. Open/click tracking stays disabled, and OTP values must not enter application logs, webhooks retained as message archives, or Sentry.
- Provider subjects, email delivery metadata, moderation inputs, advertising data, and any future push tokens must be reflected in the final privacy/data-safety disclosures and vendor retention/deletion register.
- Firebase Authentication receives the minimum Google/Apple identity data needed for sign-in. Firebase UID remains broker-local; the Game Backend stores only the provider-specific subject and optional provider email as private Auth Identity metadata.
- All fal.ai, OpenAI, Resend, RevenueCat, AdMob, storage, and webhook secrets remain server-side or in managed build credentials; none are bundled as client-readable secrets.
- Data-subject access requests served through support tooling (ADR-0036).
