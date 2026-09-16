# Paid Official Pattern rollout

This runbook implements [issue #260](https://github.com/muratti32/cross-stitch-game/issues/260) under [ADR-0061](adr/0061-change-a-published-official-pattern-between-free-and-paid-with-grandfathered-unlocks.md). It selects published, available Official Patterns for paid access and applies the selection through the operator bulk-paid endpoint.

## Selection

The tool selects six paid Patterns per category. It requires 6–10 Small tier selections overall and allows no more than half of usable Staff Picks to be paid. Community Patterns and unavailable Patterns are ignored. Available Official Patterns without a positive publishing-draft stitchable-cell count are reported as excluded.

Selection is deterministic. For attempt `k`, each usable Pattern is ranked by the SHA-256 hex digest of `<seed>:<k>:<lowercase-pattern-id>`. Categories and IDs are sorted, then the lowest six ranks in each category are selected. The first attempt satisfying the Small tier and Staff Pick constraints wins. The report records the accepted attempt, selected IDs, and a digest over the algorithm version, seed, and selected IDs.

A repeated run includes currently paid candidates, so the same seed and candidate data reproduces the same selection. A selected-only apply never makes an unselected paid Pattern free; the report warns about those Patterns.

## Required environment variables

- `ADMIN_API_URL`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_TOTP_CODE` or `ADMIN_TOTP_SECRET`

Keep credentials in the process environment. Do not put them in command arguments or reports.

For a production apply, export `ADMIN_TOTP_CODE` from the authenticator at run time. Storing `ADMIN_TOTP_SECRET` next to `ADMIN_PASSWORD` in one file collapses the operator's two factors into one for anyone who can read that file.

## Staging

Run from `backend/`. Choose and retain one seed.

```bash
npm run patterns:paid-rollout -- \
  --seed '<recorded-seed>' \
  --env-label staging \
  --report ../docs/paid-pattern-rollout/staging-<YYYY-MM-DD>-dry-run.json
```

Review the selected IDs, per-category counts, tier counts, Staff Pick count, exclusions, warnings, accepted attempt, and digest. Confirm that the report shows **60 selected Patterns across 10 categories, 6 per category**; a smaller total means Patterns were excluded and the selection must be fixed before applying. Apply only the reviewed digest:

```bash
npm run patterns:paid-rollout -- \
  --seed '<recorded-seed>' \
  --env-label staging \
  --report ../docs/paid-pattern-rollout/staging-<YYYY-MM-DD>-apply.json \
  --apply \
  --confirm-digest '<staging-dry-run-digest>'
```

Verify on staging:

- A player with a pre-existing Stitching Session can still prepare the Pattern through a Grandfathered Pattern Unlock.
- A fresh player sees the lock and price and can unlock the Pattern with Stitch Coin.
- The one-time paid-Pattern banner appears.
- The apply report has no failed or missing result.

## Rollback

If verification fails, `--revert` applies the same selection in the free direction through the same endpoint. ADR-0061 keeps existing Pattern Unlocks and refunds no Stitch Coin, and a later re-apply grants only the missing Grandfathered Pattern Unlocks.

```bash
npm run patterns:paid-rollout -- \
  --seed '<recorded-seed>' \
  --env-label staging \
  --report ../docs/paid-pattern-rollout/staging-<YYYY-MM-DD>-revert.json \
  --apply \
  --revert \
  --confirm-digest '<same-digest>'
```

## Production

Do not apply until the #258 app release is released to stores and sufficiently adopted. Use the same seed used for staging, then review production's own dry-run report and digest.

```bash
npm run patterns:paid-rollout -- \
  --seed '<same-recorded-seed>' \
  --env-label production \
  --report ../docs/paid-pattern-rollout/production-<YYYY-MM-DD>-dry-run.json
```

```bash
npm run patterns:paid-rollout -- \
  --seed '<same-recorded-seed>' \
  --env-label production \
  --report ../docs/paid-pattern-rollout/production-<YYYY-MM-DD>-apply.json \
  --apply \
  --confirm-digest '<production-dry-run-digest>'
```

Commit reviewed reports as `docs/paid-pattern-rollout/<env-label>-<YYYY-MM-DD>-<mode>.json`. The same seed can legitimately select different IDs when environment data differs. Each environment's report is its rollout record.
