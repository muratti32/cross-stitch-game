---
title: Completed Stitch Visual Contract
type: concept
created: 2026-08-05
updated: 2026-08-05
---

# Completed Stitch Visual Contract

## Purpose

A completed Pattern cell should read as a physical cross-stitch rather than a painted square. The canonical term is **Completed Stitch**; avoid node, knot, painted cell, and filled square.

## Settled appearance

- Every theme uses the same cross-shaped two-strand geometry. The strand direction and overlap order remain uniform across the Pattern.
- The unfinished Thread Color Number disappears completely once the cell becomes a Completed Stitch.
- The stitch uses the cell's DMC Thread Color as its dominant color. Bounded highlights and shadows may add depth but must not shift the hue or crush very light and dark colors.
- The thread is stylized-realistic: strand overlap and restrained depth are visible, without photographic fibers, fuzz, random grain, or shimmer.
- One fixed upper-left light direction applies across the Pattern and does not react to pan, zoom, or device movement.
- The thread sits in front of the fabric grid. Grid lines do not cross the strands; a small fabric margin keeps cell boundaries legible.
- Themes may change fabric, grid, and a restrained matte-to-satin finish. They do not change cross geometry, strand order, motion, fixed lighting, or DMC color identity.

## Motion

- A local Stitch Action begins visible feedback within the existing 50 ms p95 interaction budget, then places the two strands over 120–160 ms.
- Each Completed Stitch created by Stitch Sweep starts its own animation when crossed. Concurrent animations run independently and never queue.
- Undo changes progress immediately, then removes the strands in reverse order over 100–120 ms. If Undo arrives during placement, placement stops and reverses from its current visual state rather than first completing.
- Consecutive Undo animations run independently and never queue.
- With Reduce Motion enabled, placement and removal motion are omitted and the resulting settled state appears immediately.
- Restored or synchronized progress always appears settled. Only a Stitch Action performed on the current device animates.

## Level of detail

- Near: show the full stylized thread texture and placement/removal motion.
- Medium: show a clean cross silhouette without fine thread texture.
- Far: summarize completed cells as a solid DMC-color mosaic and omit per-cell animation.

## Release constraint

The visual is decorative relative to the interaction guarantees in ADR-0031 and the tiled SkPicture architecture in ADR-0034. It must preserve the 50 ms p95 Stitch/Undo input-to-visible budget, 60 fps pan/zoom/sweep target, bounded caches, and incremental tile invalidation; failing those gates requires simplifying or snapping animation to the settled state rather than weakening the performance contract.

## Related

- [[index]]
