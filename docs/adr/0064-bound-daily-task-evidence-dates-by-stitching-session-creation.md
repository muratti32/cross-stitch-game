# Bound Daily Task evidence dates by Stitching Session creation

**Status: accepted**

Daily Task evidence is still credited to the Reward Day of its own `occurredAt` (ADR-0063), but that date is now bounded below: it may not be earlier than the creation of the Stitching Session it belongs to, minus the same clock-skew tolerance the future check already applies. Evidence outside that window is skipped silently, exactly like the other invalid evidence ADR-0063 already skips — the batch still returns its board with a success response, because the client only acknowledges and stops retrying a batch on success.

Every Stitching Session row is created by the Game Backend in one online write, whichever Pattern kind it is for, so its creation time is server-authored before any Gameplay Event can name it — the client only starts emitting Gameplay Events for a session once it holds the server-issued session id from that write. Guest Data Promotion's transfer path reassigns a session's principal without touching its id or creation time, so the bound survives promotion there; its merge path deletes the Guest session instead, but evidence for a merged Guest session already fails ownership once the row is gone, a loss this decision does not change. This does not conflict with the Pending Coin Reward rule that valid evidence survives any Reward Day boundary: the bound decides whether evidence is valid at ingestion, once, from a timestamp the server itself wrote; it does not add a second expiry to evidence already accepted.

We state the consequence honestly rather than claim this closes fabrication. The Daily Task cap is per principal per Reward Day, and the ingest ownership check accepts evidence for any session the principal owns regardless of its status, so a fabricating client names its oldest owned session — active or completed — and backdates evidence to any Reward Day since that session's creation. The reach this bounds to is therefore the principal's tenure: every Reward Day since their first Stitching Session, inherited across Guest Data Promotion. Within that reach the gain is still a one-time sum, not a repeatable one — each past Reward Day still yields its cap at most once, the same idempotent-per-Reward-Day-per-task limit ADR-0063 already relies on. The real gain of this decision is that a fresh identity cannot backdate evidence before its first Stitching Session was created.

A legitimate device clock running behind the server costs strictly less than one running ahead: a clock too far ahead loses all evidence outright (the future check), while a lagging clock only loses evidence from the first (skew minus tolerance) of a newly created session, since re-preparing an existing active session keeps its original creation time and evidence against it is unaffected.

This amends the "currently unbounded" paragraph of ADR-0063 and its "Bound evidence dates from below" considered option; see the notes on those.

## Considered options

- A fixed Reward Day window (e.g. today and yesterday only): rejected, because it would discard genuine offline evidence that must settle on the Reward Day it actually happened in, however late connectivity returns.
- The client's own session-start timestamp: rejected, because it is client-controlled and a fabricating client could set it to whatever backdate it wants.
- No lower bound: rejected, because past Reward Days are then an unbounded multiplier on the Daily Task cap.
- A larger or per-device clock-skew tolerance: rejected for now — the existing 60-second tolerance is already calibrated for the future check, tuning it separately is a distinct decision with its own evidence, not a free variable to widen while adding a new use for it.
- Also bound a completed Stitching Session's evidence from above by its completion time: deferred, not rejected — a principal's active sessions give a fabricating client the same tenure-wide reach this decision leaves open, so bounding only completed sessions closes little on its own; it belongs in its own decision.
