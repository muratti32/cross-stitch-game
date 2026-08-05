# Completed Stitch Visual Acceptance

This document is the human evidence template for the **visual** and **spec-integration** acceptance criteria of issue #90 ("Prove Completed Stitch visual and performance release gates"). It complements `docs/release-checklist.md`, which covers the ADR-0031 performance/thermal gate only. Neither document substitutes for the other — a release needs both.

Automated coverage (TypeScript, `app/src/renderer/__tests__/completedStitchVisualState.test.ts`, `app/src/renderer/__tests__/renderer.test.ts`, `app/src/perf/__tests__/*`) proves the deterministic visual-state model, tile-invalidation, and cache-bound behavior described in `vault/wiki/concepts/completed-stitch-visual-contract.md` and issue #85. It cannot prove pixel-level fidelity against the embroidery reference or perceptual hue/contrast identity — those require a human looking at the two reference devices from `docs/app-metadata.md`:

- iOS reference device: oldest physical device on iOS 16.4 (e.g. iPhone 8 or iPhone X).
- Android reference device: oldest physical device on Android 7.0 / API 24 (e.g. Nexus 6P or Nexus 5X).

Use a preview build per `docs/release-checklist.md` §2 (`EXPO_PUBLIC_PERF_HARNESS` is not required for this checklist; a normal preview/dev build with the target Pattern loaded is enough). Load a Pattern that includes at least one very light DMC color, one mid-tone DMC color, and one very dark DMC color from the active palette (`docs/adr/0004-dmc-thread-colors-for-patterns.md`).

## How to run

1. Install the preview build on both reference devices.
2. Open a session on a Pattern with mixed color density, and complete enough cells to have a settled area at each LOD band (near/readable, mid, far/out per `app/src/renderer/tileMath.ts`).
3. Work through each row below on-device. Capture a screenshot or short screen recording per row and store it under a dated subfolder (e.g. `evidence/2026-08-05-ios-iphone8/`) referenced from the release notes; do not commit binary evidence into this repo unless the team's existing release process already does so elsewhere.
4. Record PASS/FAIL and reviewer name/date per row. A FAIL on any row blocks release per the same policy as the performance gate (`docs/release-checklist.md` §6) unless an explicit, written scope decision is recorded in the release notes.

## Checklist

| # | What to check | Discharges (AC) | Pass criteria | Result (device, date, reviewer) |
|---|---|---|---|---|
| 1 | Near-zoom settled Completed Stitch compared side-by-side against the supplied embroidery reference image | "Near-zoom settled stitches ... visually accepted against the supplied embroidery reference" | Two-strand cross, matte/satin finish, and thread depth read as physically stitched, not a painted square, on both devices | |
| 2 | Placement motion: tap an unfinished cell, observe the two-strand settle over ~120-160 ms | "... placement/removal motion ... visually accepted against the supplied embroidery reference" | Lower strand visibly places before upper strand; no flash-to-final; no visible stutter | |
| 3 | Removal motion: Undo a just-placed and a long-settled stitch | Same as #2, plus #85 Undo AC | Strands unthread in reverse order over ~100-120 ms; Undo during placement reverses from current progress, never finishes first | |
| 4 | Light DMC swatch (e.g. off-white/cream) at near zoom, all themes | "Representative light ... DMC colors retain hue identity and readable strand depth" | Highlight does not wash to pure white; hue matches the palette swatch; strand overlap still visible | |
| 5 | Mid-tone DMC swatch at near zoom, all themes | Same AC, mid-tone | Hue unchanged from swatch; visible shadow/highlight depth | |
| 6 | Dark DMC swatch (e.g. near-black) at near zoom, all themes | "... dark DMC colors retain hue identity and readable strand depth" | Shadow does not crush to pure black; hue matches swatch; strand overlap still visible | |
| 7 | Every available theme, same cell | "Preserve one cross geometry, strand order, motion contract, fixed lighting, and DMC color identity across all themes" | Only fabric/grid/finish changes between themes; geometry, strand order, and DMC hue are identical | |
| 8 | Grid layering: zoom to near LOD over stitched and unstitched cells | "grid lines never cross thread strands" (contract), symbol hiding | Grid lines stay behind thread; unfinished Thread Color Number is fully hidden under a Completed Stitch | |
| 9 | LOD transitions: zoom from near -> mid -> far continuously | Three LOD bands (contract, #85) | Near shows textured cross + motion; mid shows clean cross silhouette; far shows solid DMC mosaic with no per-cell animation | |
| 10 | Enable OS Reduce Motion, stitch and Undo a cell | "Reduce Motion" AC | Settled state appears immediately with no strand animation | |
| 11 | Close and reopen the session (restored progress) | "restored/synchronized state" AC | Previously completed cells appear already settled; no animation flood on open | |
| 12 | Trigger a remote/synchronized completion while the app is open (or simulate via a second device/account) | Same AC | The synchronized cell appears settled, not as a local placement animation | |
| 13 | Stitch Sweep across a run of eligible cells | "Sweep" AC | Each crossed cell animates independently; sweeping ahead does not visibly queue or lag behind the finger | |
| 14 | Repeated rapid Undo | "Undo" AC, no-queueing | Each Undo reflects the latest input; no backlog of reversing animations | |
| 15 | Fixed lighting check: pan and rotate the device while a stitch is mid-placement | "thread lighting remains fixed" (#85 story 24) | Highlight/shadow direction does not shift with viewport or device orientation | |
| 16 | Degradation fallback: drive the ADR-0031 late-play scenario (or the perf harness `sustained-15min` / `worst-case-rapid-stitch-during-pan-zoom` scenario) until frame pacing visibly degrades, if reproducible on the reference device | "When decorative motion cannot be maintained ... it snaps safely to the correct settled state without losing progress, replaying stale animation, or lowering the interaction gates" | Under sustained load, motion snaps to settled state (bounded by `MAX_ACTIVE_COMPLETED_STITCHES` eviction in `app/src/renderer/completedStitchVisualState.ts`); no lost completions; Stitch/Undo latency remains responsive throughout | |

## Cross-reference to automated evidence

Rows 4-9 and 16 are additionally backed by deterministic unit tests that a reviewer can point to if a row's visual result is ambiguous:

- Rows 4-6 (hue/depth bounds): `app/src/renderer/__tests__/completedStitchVisualState.test.ts` — `deriveThreadSurfaceColors` cases for light/mid/dark DMC hex values.
- Row 7 (theme invariants): same file — "uses the three stable LOD decisions and preserves cross invariants across themes".
- Row 9 (LOD bands): same file — representation mapping for `readable`/`mid`/`out`.
- Row 16 (bounded fallback): same file — "bounds the dynamic layer and snaps the oldest visual to settled" and the matching Undo-at-bound case; `app/src/renderer/__tests__/renderer.test.ts` — "undo at the dynamic layer bound dirties the evicted stitch tile" (proves only the evicted cell's tile re-dirties, not the whole grid).

These tests prove the *rule* is implemented correctly; they cannot prove it *looks right* on real hardware, which is what this checklist is for.

## Sign-off

Release ships only once every row in the checklist above is PASS on both reference devices, or a written scope decision documents and accepts a specific FAIL. Record the outcome in the same release notes location used for the ADR-0031 performance gate result.
