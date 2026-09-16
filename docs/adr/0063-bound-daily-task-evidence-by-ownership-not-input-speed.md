# Bound Daily Task evidence by ownership, not input speed

**Status: accepted**

Daily Task progress is counted from the Gameplay Event stream, and that evidence is bounded by authentication, Stitching Session ownership, and event deduplication — never by how fast the input arrived. A Stitch Sweep produces one Stitch Action for every newly filled cell inside a single gesture, so genuine stitch evidence is routinely milliseconds apart and a per-event speed floor cannot distinguish it from fabrication. Evidence dated beyond the clock-skew tolerance is still rejected, because a future timestamp is a claim about time rather than a claim about speed.

The 50-millisecond physical floor stays where it was designed to work: as an aggregate over a whole Stitching Session in the Guest Session Completion Claim validator of ADR-0062, where the cell count is large enough for the elapsed time to mean something. Applied per event to Daily Tasks it protected nothing — a Daily Task needs 100 Stitch Actions, so even at the floor the whole day's reward is reachable in five seconds — while silently discarding the progress of players who used the Stitch Sweep the game ships.

We therefore accept that a client which fabricates authenticated events for a Stitching Session it genuinely owns can reach the Daily Task cap. That is the same bounded-evidence trade-off ADR-0062 already made when it rejected treating the event stream as a canonical cell-state log. Closing it needs cell identity on a Stitch Action and a per-Pattern cell ceiling, which is a separate decision about the meaning of Gameplay Events, not a speed threshold.

This amends the Pending Coin Reward reconciliation sentence of ADR-0011 and the shared-floor sentence of ADR-0062: the backend still owns Reward Day and per-Pattern uniqueness, reward caps, and impossible-transition checks, but it owns no Daily Task event-rate check.

## Considered options

- Keep a per-event speed floor but raise or tune the threshold: rejected because no threshold separates a Stitch Sweep from a script — the sweep is the fastest legitimate input the game has, and any floor low enough to admit it admits fabrication too.
- Apply the floor as an aggregate over the Stitching Session's lifetime: rejected because a session that has existed for days carries an effectively unlimited budget, so it adds arithmetic without adding a bound.
- Count a Stitch Sweep as one Stitch Action per gesture: rejected because it contradicts the Daily Task definition, and it would make the sweep a worse way to play than tapping, punishing the accessible input.
- Add cell identity and a per-Pattern ceiling now: deferred, not rejected — it is the only real bound, and it reopens a choice ADR-0062 made deliberately, so it belongs in its own decision rather than inside a defect fix.
