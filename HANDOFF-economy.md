# Handoff — Cross Stitch Game / Coin Economy backend

**Date:** 2026-07-22 · **Repo:** `/Volumes/ssd/react_native_workspace/cross-stitch-game` · GitHub `muratti32/cross-stitch-game`
**Backend cwd:** `backend/` · **Branch:** `publish` (economy history also on `staging`, `main`)

## Workflow contract (must keep)
- **Caveman mode default** for all prose (compress; NEVER abbreviate code/paths/commands/errors). Full prose only when user asks ("detaylı anlat"/"açıkla"/"explain in detail").
- **cemşit writes the code**: `agy -p "<self-contained prompt>" --model "Gemini 3.6 Flash (High)"`. Agentic — writes files directly. Its narration is UNRELIABLE → **git diff is ground truth**. I own final write, lint, verify.
- Coin economy is **server-authoritative + idempotent**. ADR-0011 values are LOCKED (changing needs explicit decision). No env-file edits. No force push / no ticket-close without user ask. No unverified completion claims.
- Background-task notifications & /compact caveat blocks are NOT user approval.

## Repo rules that bite
- Read `CONTEXT.md`, relevant `docs/adr/*`, `docs/app-metadata.md` before acting on architecture/identity.
- **Migrations + entities are an EXPLICIT hand-registered list** in `backend/src/database/typeorm-options.ts` (imports + `migrations:[]` + `entities:[]`). NOT globbed. cemşit forgets this every time → always re-check after its authoring.
- Never invent account/project IDs/secrets; only confirmed public identifiers → `docs/app-metadata.md`.

## What is BUILT (do not rebuild) — see memory `admob-ssv-backend-missing.md` for full detail
All in `backend/src/economy/`, verified (tsc + unit + integration + migration up/down):
1. AdMob SSV ad-reward (Phase 1) — migration `1784937600000`.
2. First Completion Rewards — migration `1785024000000`, wired into `ProgressSyncService.complete()` account-only.
3. Pattern Unlock spend + prep-gate (#39/#40) — migration `1785110400000`.
4. Client Pattern Unlock UI (#41) — `app/src/api/economy.ts`, `app/app/(tabs)/(catalog)/[id].tsx`.
5. **Daily Tasks backend, account-only slice of #14** — migration `1785196800000-CreateDailyTasks`, commit `e6525d5` on `publish`. Endpoints `POST/GET /v1/economy/daily-tasks[/events]` (JwtAuthGuard, guests 403). Tables `economy.gameplay_events` + `economy.daily_color_action_counts`. `CoinLedgerRepository.grantDailyTask`/`grantedDailyTaskKeys`. 5 integration tests pass, unit 106/106.

## Key architecture fact (drove Daily Tasks design)
Backend has NO per-cell DMC color map — color lives only inside the binary pattern artifact the client downloads (`session_cell_state` = completed/incomplete only; `patterns.paletteSize` = count). So Daily Task color attribution MUST come from **client-reported first-party gameplay events carrying `dmcCode`** (ADR-0035), NOT progress-sync cell ops.

## NOT built (deferred — do NOT start without explicit user confirmation)
- **Daily Tasks CLIENT wiring**: emit gameplay events during stitching (carry `dmcCode` per Stitch Action + `color_completion`), batch-POST to `/v1/economy/daily-tasks/events`; task-board UI reading `GET /v1/economy/daily-tasks`. This is the natural next slice.
- Guest Daily Tasks + offline **Pending Coin Reward** path (ADR-0026) — current grants are account-only.
- Coin Packs (#17, RevenueCat ADR-0032), Premium Daily Coin Claim (#18), Guest Economy Promotion (#31/#32), standalone coin-balance / rewarded-ad UI surface.

## Verify gates (backend/)
- `npx tsc -p tsconfig.json --noEmit`
- `npm test` (unit: `jest --config test/jest.unit.json --runInBand`)
- `npm run test:integration` (real Postgres `DATABASE_URL=postgresql://…@localhost:5432/stitch_wish`; note: pre-existing object-storage/reconciler integration failures unrelated to economy)
- `npm run migration:run` / `npm run migration:revert` (validate up/down/up)

## GitHub ticket labels
Triage labels are `afk` (ready-for-agent) / `hitl` (needs human) — NOT matt-pocock defaults. #15 decomposed into #39/#40/#41. #14 = Daily Tasks (backend slice done, not closed).

## Suggested skills for next agent
- `grill-with-docs` (project) — grill scope + `/domain-modeling`, then `/to-tickets`, before coding a new economy slice.
- `caveman` — enforce compressed replies (auto per global CLAUDE.md).
- `qa` / `diagnosing-bugs` (project) — for verification / regressions.
- Expo plugin skills (`native-data-fetching`, `building-native-ui`) — if doing the Daily Tasks CLIENT wiring in `app/`.

## Do NOT
- Push, close issues, or start a new economy phase without explicit user ask.
- Trust cemşit narration — diff every change; re-check `typeorm-options.ts` registration.
