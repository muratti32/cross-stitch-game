# Cap tile complexity and coalesce viewport redraws on constrained devices

This decision amends ADR-0031 and ADR-0034 to define a formal Device Rendering Profile and Pan Redraw Coalescing on constrained Android devices. It addresses fatal Application Not Responding (ANR) defects observed on low-memory reference hardware, such as the Samsung Galaxy Tab A7 Lite SM-T225, where high-frequency pan gesture updates triggered synchronous Skia redraws (`renderImmediate`) and nested `SkPicture` replay exceeding the Android 5-second ANR watchdog during OpenGL GPU flush.

ADR-0031 prohibits silent device-specific degradation. This decision establishes that hardware-aware render primitive budgeting on constrained hardware is an explicit architectural scope decision, not an ad-hoc degradation:

1. **Pan Redraw Coalescing**:
Gesture Handler may dispatch viewport-pan touch events faster than the display cadence. Rather than mutating the Reanimated translation shared values on every pan movement event, translation deltas are accumulated and committed to `translateX` and `translateY` from a VSYNC-aligned frame callback (`useFrameCallback`). Gesture boundaries synchronously flush pending residual deltas. Anchored Zoom still writes scale and translation per pinch event and only flushes pending pan deltas first.

2. **Device Rendering Profile & Tile Complexity Capping**:
Android devices reporting more than 0 and at most 3.25 GiB total memory are classified into the `low` Device Rendering Profile. Android `totalMem` reports less than marketed RAM, so the threshold covers devices marketed with up to 3 GB RAM. The profile is resolved when a Stitching Session's `RendererState` is created. Other Android devices and all iOS devices use `standard`. On a low profile, each completed cross cell drops the shadow and highlight strands; the fabric rect and two base strands remain. Base DMC Thread Colors, progress, rewards, and satin/matte theme color adaptations remain fully preserved. Frame-time improvement has not yet been measured.

3. **Dependency Injection for Observability & CI**:
The `DeviceRenderingProfile` (`low` | `standard`) is passed into `RendererState`, whose constructor alone defaults it to `standard`. Session creation passes the profile detected by `perf-thermal`. This enables explicit verification of low-memory constraints in unit tests, integration suites, and the physical device performance gate (`npm run perf:gate`).

We accept slight visual texture flattening on low-memory Android hardware and frame-cadence delta buffering to reduce completed-tile replay complexity and redundant viewport transform writes while preserving gameplay, currency, and color correctness.

**Open**:
Reproduction on an Android reference device marketed with at most 3 GB RAM and pan frame-time measurement are not yet complete. Reanimated mappers may already batch Skia redraws per display frame, so the synchronous per-frame picture render remains on the UI thread and the benefit of pan coalescing is unverified.
