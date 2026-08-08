# Catalog-first ticket completion loop

## Trigger

Run when the implementation of parent issue #100 is requested and child issues #101, #102, and #103 are open.

## Source of truth

- GitHub issues #100, #101, #102, and #103 in `muratti32/cross-stitch-game`.
- `CLAUDE.md`, `CONTEXT.md`, relevant `docs/adr/` files, and `docs/agents/issue-tracker.md`.

## Ordered agents

Use exactly one implementation agent per child ticket, in this order:

1. Agent A owns #101: define and test the foreground-entry policy and protected round-trip contract.
2. Agent B owns #102: activate safe Catalog selection at the root navigation lifecycle and integrate protected round trips.
3. Agent C owns #103: build fresh iOS and Android binaries and execute the acceptance matrix.

Each agent works in its own issue branch/worktree. An agent must preserve the exact ticket number in its branch, commit, validation report, and GitHub operation.

After review approval, integrate the agent branch into `main` (fast-forward when possible; otherwise a non-squashing merge that preserves the ticket commit), push `main`, then resolve the ticket with an evidence comment and `gh issue close`. The next agent starts from that integrated `main`.

## Gate between agents

After each agent reports completion, independently review its diff, focused tests, TypeScript output, and every acceptance criterion. Do not start the next agent until the current agent's change is integrated and its ticket has an evidence-backed resolution.

Issue resolution uses `gh issue comment` followed by `gh issue close` only after the required evidence is recorded. A failed or unavailable criterion is never reported as passed.

## Checkpoints

The only human checkpoint is after the independent review of each ticket when a decision is required to resolve an external or device-dependent blocker. The brief must state the ticket number, commit, tests, device/build evidence, passed criteria, unavailable criteria, and the exact next action.

## Exception and stop rules

- If #101 is not resolved, stop before #102.
- If #102 is not resolved, stop before #103.
- If #103 cannot complete physical-device or external acceptance, mark the result blocked/unavailable, leave #103 open, and leave parent #100 open; #101 and #102 may remain closed if their own criteria are satisfied.
- Do not publish preview or production releases as part of this loop.

## Completion

The loop is complete only when #101, #102, and #103 have their required evidence and #100 can be resolved without claiming unavailable acceptance as passed. Record the final commit, validation commands, platform/build identifiers, and GitHub states in the closing brief.
