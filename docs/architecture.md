# System Architecture

Stitch Wish system architecture. Domain language: `CONTEXT.md`. Decisions: `docs/adr/`. Service inventory: `docs/app-metadata.md`. This document maps those accepted decisions onto concrete deployables, module boundaries, data layout, and runtime flows. Where this document and an ADR disagree, the ADR wins.

## 1. System overview

```
┌─────────────────────────────────────────────────────────────────────┐
│ Mobile Client (Expo, TypeScript strict)                             │
│  Expo Router · Skia SkPicture grid renderer · SQLite local-first    │
│  Local Identity Namespace · Sync Engine · Artifact Downloader       │
└───────┬─────────────────────────────────────────────────────────────┘
        │ HTTPS (REST, versioned)
┌───────▼─────────────────────────────────────────────────────────────┐
│ Game Backend (NestJS modular monolith)                              │
│  ┌────────────┐  ┌──────────────┐  ┌──────────────────────────┐     │
│  │ API        │  │ Workers      │  │ Scheduled reconciliation │     │
│  │ deployable │  │ deployable   │  │ (same codebase)          │     │
│  └─────┬──────┘  └──────┬───────┘  └──────────┬───────────────┘     │
│        └── PostgreSQL (source of truth) ──────┘                     │
│        └── Redis + BullMQ (Processing Queue, never truth) ──┐       │
└─────────────────────────────────────────────────────────────┼───────┘
        │                      │                              │
┌───────▼───────┐   ┌──────────▼──────────┐   ┌───────────────▼──────┐
│ Cloudflare R2 │   │ Conversion Engine   │   │ External providers   │
│ artifacts,    │   │ (Python FastAPI,    │   │ fal.ai · OpenAI mod. │
│ previews,     │   │  stateless, private │   │ RevenueCat · AdMob   │
│ artwork       │   │  network only)      │   │ Resend · Sentry      │
└───────────────┘   └─────────────────────┘   └──────────────────────┘

┌──────────────────────────────┐   ┌─────────────────────────────────┐
│ Web (Cloudflare Pages/Workers│   │ Operator Console (internal web  │
│ share-link fallback, legal)  │   │ app, MFA + RBAC, audit trail)   │
└──────────────────────────────┘   └─────────────────────────────────┘
```

## 2. Deployables and repositories

| Deployable | Stack | Responsibility |
|---|---|---|
| `app` | Expo SDK 54, dev client + EAS, Expo Router, `@shopify/react-native-skia` | The game. Local-first play, rendering, sync, purchases UI. |
| `backend-api` | NestJS + PostgreSQL | All domain APIs, webhook endpoints, admin API. |
| `backend-worker` | Same NestJS codebase, standalone application context | BullMQ consumers, Job Outbox dispatcher, scheduled reconciliation. |
| `conversion-engine` | Python + FastAPI, stateless | Source Artwork → DMC grid, palette, preview, statistics. Private network only. |
| `web` | Cloudflare Pages/Workers | Catalog Share Link fallback pages (live availability resolution), Privacy/Terms/Support. |
| `operator-console` | Internal web app against backend admin API | Moderation queues, appeals, support lookup, promotion recovery, exports. |

Backend API and worker are two deployables from one repository and one module codebase (ADR-0014); the worker runs as a Nest standalone context so domain services, entities, and invariants are never duplicated. The Conversion Engine is a separate service and repository because it scales independently and owns no state (ADR-0015).

## 3. Game Backend — module map

Modular monolith. Modules communicate through injected services in-process; anything crossing a transaction boundary or needing retry goes through a Processing Job + Job Outbox (ADR-0013). No module reaches into another module's tables.

| Module | Owns |
|---|---|
| `auth` | Email Sign-In OTP (keyed verifier, expiry/attempt/rate limits), Apple/Google token verification, Auth Identity bindings, session issuance, Guest Installation Identity issuance. |
| `identity` | Registered Accounts, Auth Identity Link, Account Deletion lifecycle (request → Deletion Recovery Window → finalization, tombstones), Local Data Removal signals. |
| `creator-profile` | Public Creator Profile, Profile Safety Check pipeline, Profile Reports/Investigations, Remediation, Username Reset, Creator Restriction + appeal, Creator Profile Audit. |
| `catalog` | Official/Community Patterns, Catalog Submissions (immutable snapshots), Catalog Precheck orchestration, Catalog Review workflow, Metadata Revisions + appeals, Withdrawal, Safety Removal + appeal, discovery (Staff Picks, New, categories/tags), Catalog Search. |
| `economy` | Stitch Coin ledgers (account + Guest Ledger), Pattern Unlocks, Reward Day, Daily Tasks, Ad-Equivalent Coin Pool, Pending Coin Reward validation, First Completion Rewards. |
| `commerce` | RevenueCat webhook ingestion, Commerce Ledger, Commerce Transaction Bindings, Membership Periods, Membership Credit Grants, reversals, AdMob SSV endpoint. |
| `ai-generation` | Prompt Safety Check, AI Credit Reservation, fal.ai Processing Job orchestration, AI Artwork Delivery, AI Artwork Library. |
| `conversion` | Conversion Uploads, Processing Jobs for Pattern Conversion, Conversion Recipes, Personal Patterns, Derived Personal Patterns, Pending Personal Pattern sync. |
| `sessions` | Session Preparation (idempotent), Artifact Access Grants, Progress Sync ingestion, Progress Merge, Session Completion, Replay Sessions, Late Progress Operation acknowledgement. |
| `promotion` | Guest Promotion Preview, manifest validation, Promotion Commit Lock, Promotion Transfer Package staging, serializable CAS commit, Promotion Needs Attention recovery. |
| `social` | Pattern Likes (account), Creator Blocks, Community/Profile Report intake. |
| `notifications` | Email outbox → Resend (idempotent), in-app Moderation Notices. |
| `jobs` | Job Outbox dispatcher, BullMQ producers/consumers, retries, dead-letter recovery, queue metrics. |
| `events` | First-party pseudonymous gameplay event ingestion (ADR-0035). |
| `admin` | Operator console API: separate auth stack (MFA + RBAC), audit trail on every action, Support Reference lookup, data exports (ADR-0036). |
| `storage` | R2 signed-URL issuance, checksum registry, bucket lifecycle boundaries. |

## 4. Data layer

- **Single PostgreSQL database**, one schema per bounded context (`identity`, `catalog`, `economy`, `commerce`, `progress`, `moderation`, `jobs`, `events`). Cross-schema access only through the owning module's services.
- **Ledgers are append-only.** Stitch Coin, AI Credit, Guest Ledger, and Commerce Ledger mutations insert ledger rows and update the materialized balance in the same transaction. Idempotency via unique constraints on source keys (provider transaction id, reward source key, reservation id). Balances may go negative only through Commerce/Membership Reversal.
- **Artifacts outside PostgreSQL** (ADR-0018): R2 buckets separated by data class — immutable Pattern Artifacts, public catalog previews (CDN), private AI Artwork + Personal Pattern Previews (signed access), temporary Conversion Uploads (lifecycle-deleted), moderation evidence. PostgreSQL stores object keys + checksums.
- **Object lifecycle protocol**: PostgreSQL and R2 cannot commit atomically, so every game-produced object follows a staged lifecycle recorded in PostgreSQL — `uploading → verified (checksum + size) → committed → available` — with immutable object keys. A scheduled reconciler deletes orphaned uploads and flags committed rows whose object is missing; referenced objects are never lifecycle-deleted. Conversion output is deterministic (engine version + recipe → same bytes/checksum), so a retried conversion converges on the same artifact instead of diverging.
- **Progress**: per-session Progress Operation log in fixed hash partitions by `session_id` (never partition-per-session). Unique `(session_id, op_id)` and `(session_id, device_id, device_seq)`; a server-revision index serves incremental pull. Operations carry compact causal context (per-device watermarks alongside the base revision) so the "completed wins" rule applies only to genuinely concurrent operations, never to a causally later Undo. Checkpoints store a packed cell-state bitmap, authoritative server revision, per-device accepted-sequence watermarks, terminal-completion marker, checksum, and format version. Compaction folds acknowledged operations only past proven device watermarks and keeps deduplication watermarks so a months-offline device rebases onto the checkpoint and replays are recognized, not double-applied.
- **First-party events**: append-only, monthly-partitioned table with a fixed retention window; pseudonymous identifiers only.
- **Job Outbox**: outbox rows committed atomically with their Processing Job. Identical horizontally-scalable dispatchers poll with `FOR UPDATE SKIP LOCKED` (shardable by outbox category) and publish to BullMQ using the outbox row id as the BullMQ `jobId`, closing the publish/ack ambiguity. The queue carries job identifiers only; every consumer claims and transitions the PostgreSQL job row idempotently before doing work.
- **External-call idempotency**: before any paid external submission (fal.ai, Conversion Engine), the worker persists a provider request key on the job row; an ambiguous timeout is reconciled against the provider (or the recorded key) rather than blindly resubmitted, so at-least-once delivery cannot duplicate provider cost.
- **Deletion/retention data map**: every table and bucket declares its Account Deletion Finalization behavior — erase, pseudonymize, or retain as bounded tombstone (commerce, moderation, security, idempotency evidence per CONTEXT.md). Backups age out on their own schedule; finalization does not rewrite them.

## 5. Mobile client architecture

- **Routing**: Expo Router route groups — catalog/discovery, play, create (photo/AI/editor), profile, settings. Deep links via `stitchwish` scheme + Universal/App Links for Catalog Share Links.
- **State**: TanStack Query for server data (catalog, balances, session lists); Zustand for gameplay/UI state. No server data duplicated into gameplay stores.
- **Local Identity Namespace**: one SQLite database file per identity (guest or account), stored in an OS-protected per-identity directory, holding progress operations, checkpoints, Pending Coin Rewards, Editor Drafts, Pending Personal Patterns, device-local Likes, Offline Pattern Data index, and Offline Catalog Cache. Sign-out locks (does not delete); Local Data Removal and Guest Data Reset are the destructive paths. Guest credential lives in platform secure storage. Protection uses platform facilities (iOS Data Protection; Android file-based encryption with a keystore-wrapped key where needed) — on older Android versions OS file protection alone is not sufficient. The chosen encryption approach has been verified in the Expo dev-client build and documented in [docs/android-namespace-protection.md](file:///Volumes/ssd/react_native_workspace/cross-stitch-game/docs/android-namespace-protection.md).
- **Renderer** (ADR-0034, budget ADR-0031): Skia canvas over fixed spatial tiles (16×16 or 32×32 cells), one recorded SkPicture per visible tile per layer — SkPictures are immutable, so a monolithic completed-stitches picture would cost O(grid) per tap at 300×300; only dirty tiles re-record. Layers per tile: static base (grid lines + symbols, per zoom band), completed stitches, overlay (Active Thread Color highlight, Remaining Cell Locator focus). Viewport culling with a small prefetch margin; LOD rules drop symbols/grid detail when zoomed out; symbol glyphs come from a pre-rendered atlas, never per-frame text shaping; renderer state is a compact typed-array/bitset. Pan/Anchored Zoom transforms run on the UI thread via Reanimated.
- **Stitch write path**: a Stitch Action updates the in-memory grid + dirty tile immediately and appends to a durable operation buffer; a small SQLite (WAL) transaction flushes off the frame path within a bounded interval. The flush window is the only crash-loss exposure and stays within the perceived "committed locally first" guarantee; no network, sync, conversion, or decompression work ever sits on the interaction-critical path, and background work yields to active gestures.
- **Sync engine**: foreground + opportunistic background drain of progress operations (batched, per-device sequence), Pending Coin Rewards, and Likes; pulls foreign operations/merges on session open and periodically. Connectivity State is explicit and per-operation; local play never blocks on it.
- **Artifact downloader**: resumable download via Artifact Access Grant, checksum verification, atomic persist into the identity namespace (Preparing → Ready).
- **Offline first launch**: Bundled Starter Patterns ship as verified assets (ADR-0037); their sessions become Ready from bundled bytes and reconcile identities idempotently at first connectivity.

## 6. Key flows

### Session Preparation
`POST /sessions/prepare` idempotent on (identity, pattern) — intentional: the domain allows at most one active Stitching Session per Pattern, and replay after completion creates a new Replay Session. Backend verifies availability + Pattern Unlock, creates/returns the single active session, issues an Artifact Access Grant. Device downloads, verifies checksum, atomically persists Offline Pattern Data, completes Progress Merge → Ready. Failure stays Preparing and retries the same session with a refreshed grant. Cancellation is a guarded state transition, not a bare delete: it verifies inside the transaction that no progress operation exists on any device before removing the empty session, so it cannot race a first progress upload; the Pattern Unlock is never touched.

### Progress sync and completion
Client uploads operation batches (device id + monotonic sequence). Server applies causal merge (concurrent completed-vs-incomplete → completed), acknowledges each operation, returns the authoritative revision and any foreign operations. Completion is validated server-side and becomes the terminal revision; late operations are acknowledged as superseded.

### Commerce
Client purchases through RevenueCat SDK → RevenueCat webhook (signature-verified, idempotent per provider transaction) → Commerce Ledger → grant (Stitch Coin / AI Credit / Membership Period + Credit Grant). Webhooks arrive duplicated and out of order (renewals, expirations, refunds, plan changes), so current Premium entitlement is always derived from the immutable commerce history, never from webhook arrival order. Sandbox and production transactions are segregated per environment. Client reads entitlements and balances from the backend only. Refunds/chargebacks apply idempotent reversals with the negative-balance rule.

Rewarded Ads: client asks the backend to open an ad attempt (Ad-Equivalent Coin Pool check) → backend issues a single-use nonce bound to identity, placement, and expiry, passed as SSV `custom_data` → AdMob SSV callback is verified against Google's rotating public keys, the nonce is consumed, and the provider transaction id is unique-constrained → grant → client refreshes balance. "Ad shown" client-side never implies reward.

### AI generation
Prompt → Prompt Safety Check (OpenAI moderation; flagged blocks pre-reservation) → AI Credit Reservation + Processing Job + outbox row committed in **one PostgreSQL transaction** → worker records a provider request key, then submits to fal.ai queue with webhook → webhook/worker reconciles idempotently against the job → output copied to private R2 and verified → AI Artwork Library record commits → reservation captured (AI Artwork Delivery). Explicitly modeled failure paths: webhook arriving before the worker's submit response, duplicate webhooks, missing webhook (scheduled reconciler polls by provider request key), provider success with failed R2 copy (retry the copy, never re-generate), moderation outage (fail closed, no reservation), and reversal after delivery (Commerce Reversal rule). Provider safety rejection or reconciled terminal failure releases the reservation; a worker or client timeout alone never does.

### Pattern Conversion
Artwork Approval → (photo path) Conversion Upload to temp R2 → Processing Job + outbox → worker calls Conversion Engine synchronously with bounded concurrency → artifact + preview written to R2, Conversion Recipe + Personal Pattern rows committed → temp upload deleted on success or failure (ADR-0005).

### Catalog Submission
Immutable snapshot (artifact copy in R2 + metadata + Publication Rights Declaration) → Catalog Precheck jobs: OpenAI moderation on title/description/preview, perceptual-hash Catalog Similarity Signal, deterministic Catalog Metadata Validation + Catalog Technical Validation → human Catalog Review queue in the operator console (ADR-0019) → acceptance publishes a Community Pattern. Automated results never publish or finally reject.

### Guest Data Promotion
Preview (bound to manifest checksum + state versions) → device Promotion Handoff record → Promotion Commit Lock (which freezes guest ledger mutations, reward reconciliation, and Like changes, keeping the staged snapshot stable) → staged checksummed Promotion Transfer Package registered in PostgreSQL (key, checksum, source revision, expiry, state; cleanup is reference-aware) → serializable compare-and-swap commit with explicit serialization-failure retry (economy promotion once per account, otherwise data-only) → item-by-item acknowledged handoff; repeated failure lands in Promotion Needs Attention with operator alert, never rollback (ADR-0026/0027/0028). Two invariants live in the schema, not only in the lock: every promoted ledger entry carries a stable source grant id with a destination uniqueness constraint, and the one-lifetime Guest Economy Promotion slot is a database constraint on the account.

## 7. Cross-cutting rules

- **Idempotency everywhere**: every external callback (RevenueCat, AdMob SSV, fal.ai, Resend) is signature-verified, replay-safe, and idempotency-keyed; every client mutation carries a client-generated UUID.
- **Auth/session**: guest and account use the same session mechanism — short-lived access JWT (~15 min) + opaque rotating refresh token; guest credential device-bound in secure storage. Recent reauthentication required for Auth Identity Link and Account Deletion Request.
- **Rate limiting**: per-identity and per-IP guards backed by Redis (OTP request/verify, reports, submissions, AI requests).
- **Secrets**: environment-scoped managed secret store; no provider secret ever ships in the client (see `docs/app-metadata.md`).
- **Environments**: development/staging/production fully separated across backend, database, Redis, R2, and provider projects; matching EAS build profiles. Nothing shared with CrossCraft.
- **Queue backpressure**: per-queue concurrency limits, retry classes with exponential backoff, per-identity quotas on expensive jobs (AI, conversion, submissions), circuit breakers on provider outage, and poison-job quarantine with operator recovery instead of infinite retry.
- **API versioning + migrations**: versioned client API (`/v1`); database migrations stay backward-compatible across one deploy window because API and worker deployables roll independently.
- **Observability**: Sentry (client + backend, scrubbed of prompts/artwork/pattern bytes/email/provider ids), first-party events in PostgreSQL, queue-depth/webhook-failure/stuck-job/Promotion-Needs-Attention alerts, plus reconciliation dashboards (ledger vs. provider history, R2 orphans, stuck reservations). Raw webhook payloads retained briefly for replay/audit, scrubbed per privacy posture (ADR-0035, app-metadata backend-operations table).
- **Backup/DR**: managed PostgreSQL with PITR and tested restores; R2 bucket versioning on immutable artifact buckets; secret rotation procedures per provider.
- **Testing**: domain-heavy unit tests for ledger/merge/promotion invariants; integration tests against real PostgreSQL (testcontainers); the ADR-0031 Stitch Interaction Budget runs on reference devices as a release gate, including worst cases — fully completed 300×300 Pattern, rapid stitching during pan/zoom, memory pressure, GPU-context loss, and app resume.
