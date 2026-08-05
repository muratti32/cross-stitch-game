# mcp-admin-console

MCP server wrapping the Cross Stitch Game operator console admin API
(`backend/src/admin/*`, ADR-0039) as tools. It supports authentication (login,
MFA, logout), managing Patterns and Staff Picks, creating/publishing
Official Pattern drafts, managing Catalog Tags and Categories, reviewing the
Community Pattern submission queue, approving creator-proposed metadata
revisions, replaying webhooks, and executing admin operations.

## Setup

```bash
cd mcp-admin-console
npm install
cp .env.example .env   # fill in ADMIN_API_URL, ADMIN_EMAIL, ADMIN_PASSWORD
npm run build
```

`ADMIN_EMAIL` / `ADMIN_PASSWORD` must be an Operator Account that exists in the
database `ADMIN_API_URL` points at. Operator Accounts are per-environment: a
local account does not exist on staging or production. Provision one with
`npm run operator:create` locally, or `npm run operator:create:prod` inside the
deployed container — see `backend/README.md` ("Operator accounts").

The backend always requires MFA on login (ADR-0039) — this client never
disables it server-side. There are two ways to complete it:

- Leave `ADMIN_TOTP_SECRET` unset in `.env`: `admin_login` returns an
  `mfa_required` challenge, and you complete it by hand with
  `admin_verify_mfa` and the operator's live 6-digit authenticator code (or a
  recovery code).
- Set `ADMIN_TOTP_SECRET` in `.env` to the operator's base32 TOTP secret:
  `admin_login` generates the current code itself and finishes login in one
  call, no manual step. This does mean anyone who can read `.env` has both
  factors, so treat that file like a credential, not just config.

## Register with an MCP client (e.g. Claude Code, Antigravity/agy)

Env vars load from this package's own `.env` regardless of the launching
process's working directory, so the MCP entry itself just needs to run
`dist/index.js` — no `cwd` or duplicated secrets required:

```json
{
  "mcpServers": {
    "cross-stitch-admin-console": {
      "command": "node",
      "args": ["/Volumes/ssd/react_native_workspace/cross-stitch-game/mcp-admin-console/dist/index.js"],
      "env": {}
    }
  }
}
```

## Source layout

Tool registrations are split out of `src/index.ts` into `src/tools/`.
The `src/index.ts` file acts as wiring to construct the `AdminClient`
and the `McpServer` and register each module's tools:

- `src/admin-client.ts` — HTTP client: session, MFA, refresh-on-401,
  request-id, binary responses
- `src/shared.ts` — `ok` / `fail` / `buildQuery` / `requiredEnv` helpers
- `src/tools/auth.ts` — login, MFA, logout
- `src/tools/patterns.ts` — Patterns + Staff Picks
- `src/tools/drafts.ts` — Official Pattern drafts
- `src/tools/catalog-taxonomy.ts` — Catalog Tags + Catalog Categories
- `src/tools/submissions.ts` — Community Pattern review queue
- `src/tools/metadata-revisions.ts` — creator-proposed metadata changes
- `src/tools/webhook-deliveries.ts` — inbound webhook audit + replay
- `src/tools/ops.ts` — operational alerts, reconciliation, support reference
  lookup

## Tools

### auth

| Tool | What it does |
| --- | --- |
| `admin_login` | Authenticates with credentials and returns session status or an MFA challenge |
| `admin_verify_mfa` | Completes authentication using a live 6-digit TOTP code or recovery code |
| `admin_logout` | Destroys the current session and logs out the operator |

### patterns

| Tool | What it does |
| --- | --- |
| `admin_list_patterns` | Lists all existing patterns matching filter and pagination criteria |
| `admin_get_pattern` | Retrieves full details of a specific pattern by ID |
| `admin_update_pattern_metadata` | Directly edits pattern details (distinguished from creator-proposed revisions) |
| `admin_withdraw_pattern` | Temporarily withdraws a pattern from public view |
| `admin_remove_pattern` | Removes a pattern as a moderation takedown (reversible via `admin_restore_pattern`) |
| `admin_restore_pattern` | Restores a previously removed pattern |
| `admin_list_staff_picks` | Retrieves the ordered list of featured staff pick patterns |
| `admin_add_staff_pick` | Appends or inserts a pattern into the featured staff picks list |

### drafts

| Tool | What it does |
| --- | --- |
| `admin_create_pattern_draft` | Initiates an Official Pattern draft from a source image path |
| `admin_list_pattern_drafts` | Lists all active official pattern drafts |
| `admin_get_pattern_draft` | Checks the processing status and details of a pattern draft |
| `admin_get_pattern_draft_preview` | Returns the draft's PNG preview inline (fails if over 4 MiB cap) |
| `admin_publish_pattern_draft` | Finalizes a ready draft into a live Official Pattern |
| `admin_discard_pattern_draft` | Discards a draft that will not be published |

### catalog-taxonomy

| Tool | What it does |
| --- | --- |
| `admin_list_tags` | Lists all catalog tags |
| `admin_create_tag` | Creates a new catalog tag with localized labels |
| `admin_update_tag_labels` | Updates the localized labels for an existing catalog tag |
| `admin_deactivate_tag` | Deactivates a tag to prevent future use (irreversible) |
| `admin_list_categories` | Lists all catalog categories |
| `admin_create_category` | Creates a new catalog category with a single label |
| `admin_update_category_label` | Updates the label for a catalog category |
| `admin_deactivate_category` | Deactivates a category to prevent future use (irreversible) |

### submissions

| Tool | What it does |
| --- | --- |
| `admin_list_submissions` | Lists pending community pattern submissions |
| `admin_get_submission` | Retrieves details for a specific submission |
| `admin_get_submission_preview` | Returns the submission's PNG preview inline (fails if over 4 MiB cap) |
| `admin_accept_submission` | Approves a community submission, publishing it as a public pattern |
| `admin_reject_submission` | Rejects a submission (requires safety/rights/spam/technical/quality reason) |

### metadata-revisions

| Tool | What it does |
| --- | --- |
| `admin_list_metadata_revisions` | Lists proposed pattern metadata revisions submitted by creators |
| `admin_get_metadata_revision` | Retrieves the details of a specific metadata revision |
| `admin_accept_metadata_revision` | Approves a creator's proposed metadata revision |
| `admin_reject_metadata_revision` | Rejects a revision (requires safety/rights/spam/technical/quality reason) |

### webhook-deliveries

| Tool | What it does |
| --- | --- |
| `admin_list_webhook_deliveries` | Lists inbound webhook deliveries for auditing |
| `admin_replay_webhook_delivery` | Re-runs a recorded payload through the live pipeline; can grant entitlements or currency (not undoable) |

### ops

| Tool | What it does |
| --- | --- |
| `admin_list_operational_alerts` | Lists recent system operational alerts and errors |
| `admin_get_reconciliation_findings` | Retrieves data consistency and reconciliation report findings |
| `admin_lookup_support_reference` | Deanonymizes a support code (requires 10-24 char code and mandatory audit reason) |

## Typical flows

### Official Pattern Creation

1. `admin_login` → `authenticated` immediately if `ADMIN_TOTP_SECRET` is set,
   otherwise an `mfa_required` challenge.
2. (only if step 1 returned a challenge) `admin_verify_mfa` with the current
   TOTP code → session held in memory for the rest of the process (access
   token auto-refreshes on 401).
3. `admin_create_pattern_draft` (local image path, size/color settings) →
   returns a draft id.
4. `admin_get_pattern_draft` until `status: "ready"`.
5. `admin_publish_pattern_draft` (title, creatorName, categoryCode,
   tagCodes, paid) → live Official Pattern.
6. `admin_update_pattern_metadata` / `admin_withdraw_pattern` /
   `admin_remove_pattern` / `admin_restore_pattern` to edit or change status
   later.
7. `admin_add_staff_pick` (patternId, optional 1-based position) to feature a
   Pattern; `admin_list_staff_picks` to see current order. The backend only
   exposes an atomic full-list replace (ADR-0039: no single-item add
   endpoint), so this tool reads the current order, moves/inserts the
   Pattern, and writes the whole list back in one call.
8. `admin_create_tag` (code, labels) / `admin_update_tag_labels` /
   `admin_deactivate_tag` to manage the Catalog Tags usable in `tagCodes`.
   Tags are deactivated rather than deleted once referenced, and deactivation
   is not reversible through these tools.
9. `admin_list_categories` / `admin_create_category` (code, label) /
   `admin_update_category_label` / `admin_deactivate_category` to manage the
   Catalog Categories usable in `categoryCode` (ADR-0040). Unlike Tags,
   Category labels are a single value, not localized. Categories are
   deactivated rather than deleted once referenced, and deactivation is not
   reversible through these tools.

### Reviewing the Community Pattern queue

1. `admin_list_submissions` to fetch pending items.
2. `admin_get_submission` to inspect metadata and properties.
3. `admin_get_submission_preview` to inspect the artwork as an inline PNG.
4. `admin_accept_submission` or `admin_reject_submission` with a reason.
   Accepting or rejecting are decisions on a real player's submission and
   are not reversible through these tools.

### Reviewing proposed metadata changes

1. `admin_list_metadata_revisions` to view open metadata change requests.
2. `admin_get_metadata_revision` to inspect old vs new values.
3. `admin_accept_metadata_revision` or `admin_reject_metadata_revision` to
   conclude the review.

The session lives only in this process's memory; restarting the MCP server
requires logging in again (automatically if `ADMIN_TOTP_SECRET` is set,
otherwise by re-entering a TOTP code).

## Audit logging

Every call this server makes carries a freshly generated `x-request-id`
header, so operator actions taken through these tools are correlatable in
the backend operator audit log exactly like actions taken in the web operator
console. It is generated automatically and is not a tool parameter.

## Not exposed, and why

This MCP server deliberately does not wrap the following backend admin
surfaces:

- `admin/profile-investigations` (list / get / close / remediate /
  reset-username / restrict)
- `admin/creator-restriction-appeals` (list / get / accept / uphold)

These represent player-moderation actions against real accounts—such as
restricting a creator, resetting a username, or closing an active
investigation. They are irreversible through an API, have no operator
console UI to cross-check against, and are a poor fit for an agent-driven
tool surface. They must be performed deliberately, through the backend, not
through an LLM tool call. This exclusion is a deliberate decision, not an
oversight or a gap to be filled later.

## Tests

Run the test suite:

```bash
npm test
```

The command type-checks the codebase and then runs the `node:test` suite
located in `src/admin-client.test.ts`. This suite covers `admin-client.ts`
behaviors, including content-type branching (JSON, absent headers, text,
empty bodies), automatic `x-request-id` injection, refresh-on-401 retry
semantics, and the inline binary size cap.

Tool registrations themselves are not unit tested; they are thin
passthroughs verified by type-checking and by exercising the read tools
against a running backend.
