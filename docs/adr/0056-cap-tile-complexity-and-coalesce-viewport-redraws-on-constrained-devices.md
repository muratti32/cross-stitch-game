# Cap tile complexity and coalesce viewport redraws on constrained devices

This decision amends ADR-0031 and ADR-0034 to define a formal Device Rendering Profile and Pan Redraw Coalescing on constrained Android devices. It resolves the fatal Application Not Responding (ANR) defects observed on low-memory reference hardware (such as the Samsung Galaxy Tab A7 Lite, SM-T225, with <= 3 GB RAM) where high-frequency pan gesture updates triggered synchronous Skia redraws (`renderImmediate`) and nested `SkPicture` replay exceeding the Android 5-second ANR watchdog during OpenGL GPU flush.

ADR-0031 prohibits silent device-specific degradation. This decision establishes that hardware-aware render primitive budgeting on constrained hardware is an explicit architectural scope decision, not an ad-hoc degradation:

1. **Pan and Pinch Redraw Coalescing**:
Gesture Handler dispatches touch events at the hardware digitizer sampling rate (up to 120–240 Hz). Rather than mutating the Reanimated transform shared values on every individual touch move event, translation deltas are accumulated across incoming touch events and committed to `translateX` and `translateY` strictly once per display frame via a VSYNC-aligned frame callback (`useFrameCallback`). Gesture termination (`onEnd`) synchronously flushes any pending residual deltas before starting momentum decay. This caps native Skia scene redraw requests to at most 1 per display frame, eliminating Android main-thread message queue starvation without adding perceptual latency.

2. **Device Rendering Profile & Tile Complexity Capping**:
Devices with <= 3.25 GB total RAM are classified into the `low` Device Rendering Profile (derived deterministically at startup from `PerfThermalModule.getDeviceProfile().totalMemoryBytes`). On a low profile, `readable` Level of Detail (LOD) completed stitches are recorded as plain `cross` stitches (two base strand lines, without the heavy shadow underlay and highlight strokes that define `textured-cross`). This reduces Skia draw operations by over 60% per tile, keeping nested `SkPicture` replay and EGL buffer presentation well within the Mali/PowerVR GPU frame budget. Base DMC Thread Colors, progress, rewards, and satin/matte theme color adaptations remain fully preserved.

3. **Dependency Injection for Observability & CI**:
The `DeviceClass` (`low` | 'standard') is passed into `RendererState` and `StitchRenderer` as an injectable property, defaulting to the device profile detected by `perf-thermal`. This enables explicit verification of low-memory constraints in unit tests, integration suites, and the physical device performance gate (`npm run perf:gate`).

We accept slight visual texture flattening on low-memory Android hardware and frame-cadence delta buffering in exchange for zero main-thread ANRs during viewport interaction, sustained 60 fps pan performance on low-end Mali and PowerVR GPUs, and full preservation of gameplay, currency, and color correctness.
