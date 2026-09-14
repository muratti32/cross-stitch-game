# Record Render-Stop Exposure in first-party events

The first-party Gameplay Event stream records `render_stop_exposure` as an explicit, bounded exception to ADR-0035's Sentry-for-performance split. Sentry can report a crash or ANR recurrence but cannot count the non-crashing exposures needed for a denominator. The observation is deliberately narrower than general lifecycle analytics and is not mirrored to Firebase under ADR-0055.

This ADR does not merge the evidence for #148 and #248. #148 is the unconfirmed
Android `AppExitInfo` `HardwareRenderer.setStopped` signal where the main thread
waited on RenderThread; #248 is the separate active-pan `renderImmediate`
signature. No shared root cause has been established, so #248's mitigation or
reproduction cannot close #148.

One exposure is one `active` to `background` edge while a production Android Stitching Session canvas is visible and its screen is focused. An `active` to `inactive` to `background` sequence is the same single edge. This proxy is broader than the reported reproduction condition of a late-play Pattern with an active Completed Stitch animation; it measures opportunities for recurrence, not that condition, an ANR, or a rendering cause.

The payload is exactly `release`, `android_api`, and `device_rendering_profile`. `release` combines the native application version and native build version as `<version>+<buildVersion>` so every observation belongs to one build; the client emits nothing if either value is unavailable. Android API is a positive integer and Device Rendering Profile is the closed `low` or `standard` enum. The payload carries no Pattern, content, session, player, or identity field. As with every Gameplay Event, the stored row is linked to the authenticated principal.

The observation window starts only with the first production release containing this event. If the exact ANR does not recur across two consecutive production releases and at least 10,000 combined eligible exposures, the issue may close as `not reproducible / impact unconfirmed`, never as fixed. A recurrence resets the evidence question; absence before this event ships does not count.

We accept a narrowly scoped, integer-and-enum-only performance exposure in the first-party stream to make the closure window measurable while keeping content and identity out of its payload and avoiding a second Firebase copy.
