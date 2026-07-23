# Stitch Wish Operator Console

Game-owned web console for Official Pattern operations and Support Reference
investigation (ADR-0039). Next.js 16 App Router + TypeScript strict + Tailwind
+ shadcn/ui + TanStack Query.

## What it does

- **Login** — operator email + password, then mandatory TOTP MFA (or a
  recovery code). Tokens live in httpOnly `Secure` `SameSite=Strict` cookies
  and never reach browser JavaScript; every API call goes through Next Route
  Handlers that proxy to the backend `/v1/admin/*` endpoints with a
  transparent refresh-and-retry on 401.
- **Dashboard** — pattern/draft counts at a glance.
- **Patterns** — paginated searchable list with status filter tabs; detail
  page edits metadata (title, creator, category, tags) and runs the explicit
  withdraw / remove / restore status commands behind confirm dialogs.
- **Drafts** — upload a PNG/JPEG source image with conversion parameters; the
  backend converts asynchronously (durable Processing Job per ADR-0013) while
  the console polls. Ready drafts are reviewed and published with a
  free-or-paid choice only — the Pattern Unlock Price Tier is always derived
  from the stitchable-cell count.
- **Staff Picks** — drag-to-reorder featured list saved as one atomic batch
  replacement.
- **Tags** — create Catalog Tags, upsert per-locale labels, deactivate (never
  delete) referenced tags.
- **Support References** — resolve a player-provided opaque code to its owned
  server records; every lookup requires a reason and writes an operator audit
  record.

## Running locally

1. Backend must be up (see `../backend`) with the `ADMIN_*` environment
   variables set, and at least one operator created via
   `npm run operator:create`.
2. Copy `.env.example` to `.env.local` and point `ADMIN_API_URL` at the
   backend (server-only; never exposed to the browser).
3. `npm install && npm run dev` — if the backend already holds port 3000, run
   `npm run dev -- --port 3001` and open [http://localhost:3001](http://localhost:3001).

## Verification

```bash
npx tsc --noEmit
npm run lint
npm run build
```
