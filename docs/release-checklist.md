# Release Checklist

This document details the mandatory validation steps required before publishing a new release of **Stitch Wish**. The central quality gate is the **Stitch Interaction Budget (ADR-0031)**.

---

## Stitch Interaction Budget Gate (ADR-0031)

To protect the core stitching loop from frame drops, excessive device heat, and network/background activity blockages, every production release must be validated on physical reference hardware.

### 1. Reference Devices
Tests must be executed on the oldest supported physical reference hardware:
- **iOS Reference Device**: Oldest physical device supporting **iOS 16.4** (e.g., iPhone 8 or iPhone X).
- **Android Reference Device**: Oldest physical device supporting **Android 7.0** (API 24) (e.g., Nexus 6P or Nexus 5X).

---

### 2. Producing the Build
The performance harness is stripped from standard production builds. To build a profile package containing the harness:
1. Ensure the environment variable `EXPO_PUBLIC_PERF_HARNESS=1` is set in your build environment.
2. Build the app using a local preview profile:
   ```bash
   # Android
   EXPO_PUBLIC_PERF_HARNESS=1 npm run build:preview:android

   # iOS
   EXPO_PUBLIC_PERF_HARNESS=1 npm run build:preview:ios
   ```

---

### 3. Executing the Harness
1. Launch the preview build on the reference devices.
2. Open the harness route `/perf` (source: `app/app/(dev)/perf.tsx`). Reach it with a deep link into the running build (`npx uri-scheme open <scheme>://perf --ios` / `--android`, scheme from `app/app.json`). The route renders a "Perf harness disabled" notice unless the build was made with `EXPO_PUBLIC_PERF_HARNESS=1`.
3. Confirm the "this is a reference device" toggle on the harness screen; the gate rejects any report whose `device.isReferenceDevice` is false.
4. Complete the performance suite:
   - **Sustained Scenario**: Trigger the **15-minute sustained run scenario** (`sustained-15min`) and keep it running for the full 15 minutes.
   - **App Resume Scenario**: Execute the operator-driven **app-resume scenario** (`worst-case-app-resume`) by backgrounding and resuming the app.
   - **Interactive Scenarios**: Perform all other required interaction scenarios (stitch-latency, undo-latency, pan, anchored-zoom, stitch-sweep, etc.).
5. Export the resulting JSON `PerfRunReport` files from each device (the harness shows the file path and offers a Share action).
6. Save the exported files to the performance reports directory: `app/perf-reports/`.

---

### 4. Running the Release Gate CLI
From the `app/` directory, run the verification gate:
```bash
npm run perf:gate -- --reports perf-reports/
```

To run with a thermal waiver for older Android devices:
```bash
npm run perf:gate -- --reports perf-reports/ --allow-thermal-unsupported "Android 7.0 (API 24) reference hardware lacks thermal APIs"
```

---

### 5. Interaction Budget Thresholds (ADR-0031)

| Metric Class | Target / Budget | Minimum Samples | Notes |
| :--- | :--- | :--- | :--- |
| **Stitch & Undo Latency** | p95 $\le$ 50 ms | 100 samples | Immediate local UI update |
| **App Resume Latency** | p95 $\le$ 50 ms | 10 samples | Fast interaction recovery |
| **Viewport Pan / Zoom** | mean FPS $\ge$ 58 | 300 frames | Targets 60 FPS, slow frame threshold = 20 ms |
| **Slow Frame Ratio** | $\le$ 5% | 300 frames | Percentage of frames > 20 ms |
| **p99 Frame Time** | $\le$ 33 ms | 300 frames | Strict frame-time ceiling |
| **Sustained Thermal** | Strictly < `serious` | Continuous | Must remain in `nominal` or `fair` state |

> [!IMPORTANT]
> **Android Thermal Waiver Rule (Below API 29)**:
> Android versions below API 29 (Android 10) do not support the platform thermal state API, causing the report to record a worst state of `unsupported`. 
> - If `--allow-thermal-unsupported "<reason>"` is provided with a valid reason, the CLI will waive this failure.
> - The status will be reported as `WAIVED`, never a `PASS`.
> - A `WAIVED` run may ship only if the waiver reason is recorded in the release notes together with the thermal evidence gathered another way (for example a manual 15-minute touch/heat observation on the Android reference device). It is never recorded as a pass.

---

### 6. Release Gate Policy

> [!CAUTION]
> **A RED GATE BLOCKS THE RELEASE**:
> Any hard failure (FAIL status) from `perf:gate` strictly blocks release deployment.
> - **Exceptions**: Under ADR-0031, any exception to proceed with a red gate requires an explicit, written scope decision document detailing the regression, the rationale, and the mitigation plan, recorded permanently in the release notes.
