# mcp-admin-console

MCP server wrapping the Cross Stitch Game operator console admin API
(`backend/src/admin/*`, ADR-0039) as tools: login + MFA, list/update/
withdraw/remove/restore Patterns, create → poll → publish Official Pattern
drafts from a source image, manage Staff Picks, and manage Catalog Tags and
Catalog Categories.

## Setup

```bash
cd mcp-admin-console
npm install
cp .env.example .env   # fill in ADMIN_API_URL, ADMIN_EMAIL, ADMIN_PASSWORD
npm run build
```

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

## Typical flow

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

The session lives only in this process's memory; restarting the MCP server
requires logging in again (automatically if `ADMIN_TOTP_SECRET` is set,
otherwise by re-entering a TOTP code).
