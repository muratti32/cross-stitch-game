# Validate Guest Session Completion Claims with gameplay evidence

**Status: accepted**

A Guest Player claims Session Completion online through the existing completion endpoint. Guest Session Progress remains device-local under ADR-0026; the claim uploads no cell state. The Game Backend therefore validates bounded gameplay evidence instead of recomputing the completed grid.

The backend accepts a claim only for the Guest Installation Identity's own locked Stitching Session and a Pattern that has not received Safety Removal. For an eligible catalog Pattern, the client-asserted completed-cell count must equal the Pattern width multiplied by height, at least one authenticated ingested `stitch_action` Gameplay Event must exist for that Guest and Session, and elapsed server time since session creation must be at least 50 milliseconds per cell. The same 50-millisecond physical floor governs Daily Task event velocity. A missing cell count is invalid input; an ownership mismatch is not disclosed; failed evidence is reported as an implausible completion with the failed check.

An accepted claim marks the backend session completed and records the same terminal completion marker the account path writes, so a session later carried into a Registered Account by Guest Data Promotion stays immutable history instead of reopening on a late device operation. Eligible catalog Patterns grant the First Completion Reward into the Guest Ledger exactly once per Guest principal and Pattern. The session completion and Coin grant commit atomically, and the existing ledger source key makes delivery and replay idempotent. Personal Patterns may complete but never grant this reward.

The device records local completion and its Guest Session Completion Claim durably before delivery. Gameplay Events flush before the claim so its authenticated evidence exists. Offline and retryable failures remain a Pending Coin Reward and retry when the existing gameplay-event flush runs, when the session resumes, and whenever the app returns to the foreground, so a Guest who never reopens a session still delivers the claim. One claim the backend cannot accept yet never blocks the delivery of the others. A successful replay resolves the local record without another grant; a 404, 409, or 410 resolves it as rejected without reopening or deleting local Session Completion.

Guest progress sync remains out of scope. Registered Account progress sync and completion validation keep their existing server-cell-state behavior. This decision extends ADR-0026's minimal backend session identity and Pending Coin Reward model without moving Guest Session Progress into Account Cloud State.

## Considered options

- Enable full Guest Session Progress sync: rejected because ADR-0026 deliberately keeps Guest progress installation-scoped and only the minimum server identity and economy evidence belong in the backend.
- Upload every stitch event and require at least as many events as completed cells: rejected because event batching, deduplication, Undo, and existing offline play do not make the event stream a canonical cell-state log; ownership, one ingested stitch, asserted full count, elapsed time, and once-per-Pattern limits provide the bounded evidence standard.
- Leave Guest Players unrewarded: rejected because it makes paid Pattern Unlocks harder for Guests than ADR-0011's Unlock Earnability Target intends and contradicts the Guest Ledger and Pending Coin Reward model.
