# Stitch Wish — Guest Identity & Storage Security

This module manages the anonymous guest credentials (`installationKey` and `credentialSecret`), backend API token state, and local sqlite database namespace switches.

## Platform Storage & Encryption Details

### iOS
On iOS devices, files stored within the application's `Documents` and `Library` directories are protected by default under iOS's native **Data Protection** feature. When the device is locked, files are encrypted with keys derived from the hardware UID and the user's passcode. Database files (e.g., `namespace_guest_<id>.db`) and platform settings persist securely within this protected sandbox.

### Android
Modern Android operating systems (Android 7.0 and higher) utilize **File-Based Encryption (FBE)**, allowing individual files to be encrypted with distinct keys. The credential storage (`expo-secure-store`) wraps sensitive secrets (like `credentialSecret`) inside the Android Keystore system.

To support secure operations on older Android devices or custom Android distributions, a keystore-wrapped-key mechanism is utilized. Because native keystore interactions can behave unpredictably across diverse device manufacturers, this must be manually verified using a **development client build (dev-client)**.

---

## Manual Verification Steps (Android Device Pass)

To verify the keystore-wrapped-key encryption approach on physical Android devices or emulators, follow this checklist:

1. **Build a Dev-Client**:
   Run the pre-build command to generate the native Android code and build a custom development client:
   ```bash
   npx expo run:android
   ```
   Do *not* test this using the standard Expo Go client, as Expo Go does not execute native secure storage operations in the same container context.

2. **Trigger Identity Creation**:
   - Run the application without internet connectivity.
   - Verify the profile tab displays `"Identity Pending (Offline)"` and that the app plays normally (offline-first).
   - Restore internet connection and verify that the identity bootstrap succeeds.
   - Note down the `guestId` from the Profile or Settings screen.

3. **Validate Keystore Encryption Persistence**:
   - Force close the application.
   - Lock the Android device, then unlock it.
   - Open the application again.
   - Verify the application starts successfully and automatically reads the stored keys to authenticate the session (i.e. you remain logged in as the same guest, displaying the correct `guestId` without needing to re-register).

4. **Verify Database File Location (Rooted Device or Emulator)**:
   - Run the ADB shell:
     ```bash
     adb shell
     ```
   - Inspect the app sandbox databases directory (substituting your package name):
     ```bash
     run-as com.avk.stitchwish ls -la /data/data/com.avk.stitchwish/databases/
     ```
   - Verify that:
     1. `stitch_wish.db` is renamed/adopted to `namespace_guest_<guestId>.db` after the first connectivity pass.
     2. A fresh launch after logout uses a separate database instance and does not leak session data from other guests.

5. **Simulate OS Key Rotation / Lock Screen Change**:
   - Go to Android System Settings -> Security -> Screen Lock.
   - Change your screen lock credential type (e.g., switch from PIN to Pattern, or re-enroll biometric data).
   - Relaunch the application.
   - Verify that the Android Keystore did not corrupt or lose the wrapped keys, and the `expo-secure-store` values are still successfully decrypted.
