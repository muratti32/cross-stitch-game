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
| Mobile build and submission | Expo Application Services (EAS) | **Decided** (ADR-0034) | Development, preview, and production builds; signing and store submission. | Expo organization, project ID, project owner, build-profile names |
| Apple distribution, auth, and optional push transport | Apple Developer + App Store Connect | **Required** | App distribution, Sign in with Apple, IAP products, and APNs credentials if push is enabled. | Team ID, App Store app ID, issuer/key IDs, Sign in with Apple configuration, APNs key ID, private-key secret references |
| Google distribution and authentication | Google Play Console + Google Cloud OAuth | **Required** | Play distribution, IAP products, and Google Sign-In. The Game Backend validates the intended audience and maps the verified Google `sub` to `(google, sub)`; Google is not the account source of truth. | Cloud project ID/number, backend audience/server OAuth client ID, iOS client ID and reversed-client scheme, Android client IDs and SHA-1/SHA-256 per build environment, Play app ID |
| Transactional email | [Resend](https://resend.com/docs/dashboard/domains/introduction) | **Required** capability; Resend **recommended** | Deliver the six-digit Email Sign-In code and required Moderation Notice email. The Game Backend creates the code, stores only a keyed verifier, owns expiry/attempt/rate limits, and sends through an idempotent email outbox; Resend is delivery only. Disable open/click tracking. | Team ID, verified sending subdomain, From/Reply-To addresses, template IDs, webhook endpoint, API-key and signing-secret references |
| Store purchase event normalization | RevenueCat | **Decided** (ADR-0032) | Verified store input into the game-owned Commerce Ledger; never the balance or entitlement source of truth. | Project/app IDs, entitlement/offering IDs, public SDK keys, webhook endpoint, secret references |
| Rewarded advertising and consent | Google AdMob + Google UMP | **Decided** (ADR-0033) | Player-started Rewarded Ads only, with Server-Side Verification. First release uses non-personalized/no-IDFA delivery so it performs no cross-app tracking and requests no ATT permission. No banners, interstitials, or ad-funded AI Credit. | App/ad-unit IDs per environment, SSV callback, UMP configuration, consent mode |
| AI artwork generation | fal.ai | **Decided** (ADR-0003) | `fal-ai/flux-2/turbo`, queue/webhook delivery, provider safety check, and backend reconciliation. | Account/application ID, model version, webhook endpoint, server-side secret reference |
| Text and image safety signals | [OpenAI Moderation](https://developers.openai.com/api/docs/guides/moderation) | **Decided** (ADRs 0003 and 0019) | `omni-moderation-latest` for AI prompts and Catalog Precheck text/image signals. Automated profile-avatar safety is also required; reusing this provider is recommended. Automated signals never publish or finally reject catalog content. | Project ID, model name, server-side secret reference, data-control/retention status, rate and cost alerts |
| Client crash and performance telemetry | Sentry | **Decided** (ADR-0035) | Crash reporting and the ADR-0031 interaction-performance release gate. Prompts, artwork, Pattern bytes, email, and provider identifiers must be scrubbed. | Organization/project IDs, DSNs per environment, source-map auth secret reference, alert owners |
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
| Operator console | Game-owned, MFA- and RBAC-protected tooling for catalog/profile moderation, appeals, reports, Support Reference lookup, promotion recovery, account deletion, and data exports; all actions need an audit trail. | **Required / TBD** |
| Backend operations | Central logs, uptime checks, API/worker health, PostgreSQL/Redis health, queue backlog, webhook failures, stuck Processing Jobs, and `Promotion Needs Attention` alerts. | **Required / TBD** |
| Secrets and key management | Environment-scoped encrypted storage for provider API keys, OAuth/APNs keys, database credentials, and webhook signing secrets, with least privilege, access audit, and rotation procedures. Use the hosting provider's managed secret store or a dedicated KMS/secret manager. | **Required / TBD** |
| Product analytics | Pseudonymous first-party event schema stored and queried beside Game Backend domain data; no third-party product-analytics SDK. | **Decided** (ADR-0035) |

### Firebase, push, and OneSignal boundary

- Firebase Authentication, Firestore, Realtime Database, Firebase Storage, Analytics, and Crashlytics are **not part of the first-release stack**. They would duplicate the Game Backend/PostgreSQL authority, S3-compatible storage, first-party analytics, or Sentry.
- A Firebase project is needed only if Android push is enabled, to provide FCM v1 credentials. Google Sign-In itself is configured through Google Cloud OAuth; neither a Firebase UID nor an email match becomes a Registered Account identifier.
- There is no mandatory push-notification flow in the accepted first-release domain. Email and durable in-app records remain the required delivery channels for moderation notices.
- If transactional push is added, start with [`expo-notifications` and Expo Push Service](https://docs.expo.dev/push-notifications/overview/) because the client already uses Expo. Push is a best-effort convenience signal, never the source of a moderation, commerce, progress, or deletion state; the backend must process push tickets/receipts and remove invalid tokens.
- OneSignal is **deferred**. Reconsider it only when there is an explicit need for campaign authoring, segmentation, or multi-channel orchestration that Expo Push Service cannot satisfy. If adopted later, its analytics, location, email, SMS, and in-app campaign features stay disabled unless separately approved, and only opaque Game Backend identifiers may be used.
- Do not use Firebase Dynamic Links. Catalog Share Links use the game's own HTTPS domain with Universal Links/App Links and a web fallback (ADR-0022).

### Provisioning checklist

- [ ] Acquire the branded domain and configure DNS, Privacy Policy, Terms/EULA, Support, and Catalog Share Link routes.
- [ ] Create separate development/staging and production resources wherever a provider supports them; never share CrossCraft projects, databases, buckets, queues, or credentials.
- [ ] Provision Resend, verify a dedicated sending subdomain with its SPF/DKIM records, publish a DMARC policy, define OTP and moderation templates, and configure idempotent bounce/complaint webhooks.
- [ ] Create Apple and Google authentication credentials with the exact locked bundle/package identifiers and configure allowed redirects/audiences.
- [ ] Select the backend host, managed PostgreSQL provider, and managed Redis provider; document regions, backup/PITR policy, restore test, connection limits, and cost alerts.
- [ ] Create separate object-storage buckets or prefixes for temporary Conversion Uploads, private AI Artwork and Personal Pattern Previews, immutable Pattern Artifacts, public catalog previews, and moderation evidence; apply least-privilege keys and data-specific lifecycle rules. Never retain the full-resolution Local Photo Source.
- [ ] Provision RevenueCat products/webhooks, AdMob rewarded units/SSV/UMP, fal.ai webhooks, OpenAI moderation, and Sentry projects for non-production and production environments.
- [ ] Deploy the operator console and backend data-export/support tools before enabling Catalog Submission or public creator profiles.
- [ ] Add webhook signature verification, idempotency, replay handling, secret rotation, uptime alerts, and runbooks for every external callback.
- [ ] Update App Store privacy details, Google Play Data safety, the Privacy Policy, and the vendor deletion/retention register after the final providers are provisioned.

For every provisioned service, record its environment, public account/project IDs, region, public endpoint/domain, secret-reference names, data classes and retention, backup policy, operational owner, budget alert, and last verification date.

## Privacy posture

- No third-party analytics SDK; first-party pseudonymous gameplay events only (ADR-0035).
- No App Tracking Transparency prompt — no cross-app tracking occurs (ADR-0035).
- Resend receives only the destination email address and minimum transactional content required for Email Sign-In and Moderation Notice delivery. Open/click tracking stays disabled, and OTP values must not enter application logs, webhooks retained as message archives, or Sentry.
- Provider subjects, email delivery metadata, moderation inputs, advertising data, and any future push tokens must be reflected in the final privacy/data-safety disclosures and vendor retention/deletion register.
- All fal.ai, OpenAI, Resend, RevenueCat, AdMob, storage, and webhook secrets remain server-side or in managed build credentials; none are bundled as client-readable secrets.
- Data-subject access requests served through support tooling (ADR-0036).
