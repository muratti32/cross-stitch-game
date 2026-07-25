# Webhook delivery retention

Inbound RevenueCat, AdMob SSV, and fal.ai callback payloads are scrubbed before
they are archived. The default retention window is 30 days
(`WEBHOOK_ARCHIVE_RETENTION_SECONDS=2592000`); the jobs worker purges expired
rows hourly (`WEBHOOK_ARCHIVE_PURGE_INTERVAL_SECONDS=3600`). Operators can
review the recent archive or replay a delivery through the in-process Admin
API. Verification-failed rows are retained for audit but cannot be replayed,
because replay never retains provider signing material.
