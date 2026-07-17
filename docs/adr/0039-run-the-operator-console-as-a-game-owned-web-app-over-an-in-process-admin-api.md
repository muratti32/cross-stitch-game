# Run the operator console as a game-owned web app over an in-process admin API

The first-release Operator Console is a separate Next.js web application in
this repository that talks to a new `admin` module inside the existing NestJS
API process, not a separate deployable, a third-party CMS, or an extension of
the player-facing endpoints. Operator identity is fully game-owned: an
`operator_accounts` table with argon2id password hashing and mandatory TOTP
MFA, hashed single-use recovery codes, and short-lived operator tokens issued
with signing material, issuer, audience, and principal type that are disjoint
from player tokens, so a player or Firebase credential is structurally unable
to open any `/admin/*` endpoint. Authorization uses explicit permission checks
mapped from roles from day one, even while a single operator exists.

Official Pattern creation reuses the durable Processing Job, outbox, and
BullMQ conversion pipeline mandated by ADR-0013 through a new
official-pattern-draft job type instead of a synchronous conversion call: the
upload returns a draft identifier immediately, the console polls until the
draft is ready, and publishing is a separate idempotent command. The Pattern
Unlock Price Tier of a paid Official Pattern is always derived from its
stitchable-cell count; the console offers only a free-or-paid choice. Staff
Pick reordering is one atomic batch operation, Catalog Tags are deactivated
rather than deleted once referenced, and status changes go through explicit
publish, withdraw, and remove commands rather than arbitrary field updates.

Every mutation writes an Operator Audit Log row in the same database
transaction, with database-level protection against update and delete, and
security events (failed sign-ins, MFA activity, authorization denials) are
committed independently so a rolled-back domain transaction cannot erase them.

We accept running the admin surface in the same process and database as the
player API for operational simplicity while there is one operator; splitting
into a separately deployed admin API with its own network access, secrets, and
least-privilege database credentials is expected when player-submission
moderation, player PII tooling, or additional operators arrive.
