# Group presented backend errors and issue one Support Reference per failure

`localizeServerError.ts` (#159, ADR-0035) reports every localized backend
error to Sentry so a Support Reference can be traced back to a diagnostic
event when there is no backend record to point support at. Without an
explicit Sentry fingerprint and with a constant capture message, Sentry
grouped every presented error by its call stack instead of by what actually
failed, merging or splitting unrelated failures (catalog 503, ad claim 400,
username 409) under one arbitrary issue. Worse, several call sites invoke
`localizeServerError` from a component's render body (e.g. `SectionError` in
`app/(tabs)/(catalog)/index.tsx` via `presentCatalogError`), so every
re-render of the same unresolved error captured a new event and showed the
player a new Support Reference for a failure they had already seen once.

We now capture each presented failure explicitly fingerprinted by
`['server-error', key]`, where `key` is the backend `reason` when it is
code-shaped (`/^[a-z0-9_]{1,64}$/`) and the HTTP status otherwise - some
endpoints put free English prose in `reason` (see `creatorProfile.ts`), and
prose is never used as a grouping key. The capture message and Sentry issue
title become `Backend error presented: <key>` instead of the previous
constant string, and a `server_error_code` tag carries the same key
alongside the existing `server_error_status` tag and `server_error` context.

A module-level `WeakMap<Error, string>` caches only the Support Reference
per presented `Error` object, not its localized text. Presenting the same
`Error` object again (the render-path case above) returns the cached
reference without a new Sentry capture; a genuinely new `Error` instance
still captures once. The localized text is always re-resolved through
`i18n.t` on every call, so a player who switches App Display Language while
an error screen is still visible sees it re-translate.

A recognized reason (`different_account`, `provider_rejected` in
`serverErrorPresentation.ts`) already shows no Support Reference to the
player, because the player-facing text is specific enough to act on without
one. We now also skip the Sentry capture entirely for that case rather than
sending an event nobody can look up, leaving only an optional breadcrumb.
The presentation decision (known vs. generic) is made first via the
existing pure `presentServerError`, and only the generic path goes on to
mint or reuse a Support Reference - `presentServerError` itself is
unchanged and stays pure.

An expected 4xx (e.g. `409` on a username conflict) is still captured: its
Support Reference must stay findable in Sentry, so nothing here drops
events via `beforeSend` or a status allowlist - it only fixes fingerprint
and dedup.

**Alternatives considered:**
- A backend-issued correlation id returned in every error response, so the
  Support Reference always corresponds to a backend log line: deferred to a
  follow-up, since it needs backend-side plumbing outside this fix's scope.
- Dropping player-presented error events via `beforeSend`: rejected, because
  the Support Reference must remain traceable to a diagnostic event even for
  expected failures like a username conflict.
- Refactoring every render-path caller onto a `useEffect`/hook-based capture
  instead of capturing directly from render: deferred to a follow-up: it is
  a larger, multi-call-site refactor and the object-keyed dedup above
  already removes the duplicate-event symptom without it.

We accept a small risk that two structurally different failures sharing the
same HTTP status and no code-shaped reason still group together in Sentry,
in exchange for immediately fixing the grouping and duplicate-reference
problems without backend changes.
