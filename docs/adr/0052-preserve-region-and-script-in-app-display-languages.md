# Preserve region and script in App Display Languages

App Display Languages use canonical BCP 47 identifiers so supported region and script variants such as Brazilian Portuguese or Simplified Chinese are not collapsed into a base language. Resolution tries an exact supported identifier first, then a supported base language, then the fixed English fallback; a device override stores the canonical supported identifier.

A player following the device language automatically begins using a newly supported matching language after an app update. An explicit per-device override remains unchanged, no forced migration prompt appears, and the player can still switch immediately in Settings.

This extends ADR-0051's English-and-Turkish first release. We accept additional catalog, migration, and test complexity because adding base-language-only identifiers now would make later regional or script variants ambiguous and costly to correct.
