# Android Namespace Protection & Security Verification

This document details the security design, platform protection mechanism, and manual dev-client verification procedures for the **Local Identity Namespace** on Android.

---

## 1. Security Requirements

Per the specifications in [Issue #7](https://github.com/muratti32/cross-stitch-game/issues/7), the Local Identity Namespace must satisfy the following constraints:
1. **Platform Secure Storage Boundary**: Sensitive credentials (the Guest Installation Identity `installationKey` and `credentialSecret`, as well as rotation refresh tokens) must reside exclusively in platform secure storage (`expo-secure-store`). They must **never** be saved in the SQLite database files or plaintext configuration caches.
2. **Sandbox Isolation**: The SQLite database files (e.g., `namespace_guest_<id>.db`) must be completely isolated from other applications on the device.
3. **Identity Partitioning**: A second identity on the device must be unable to read or reuse a first identity's local namespace.
4. **Encryption at Rest**: Local database files and credentials must be encrypted when the device is locked, protecting the player's offline progress, Likes, and ledger-validation evidence.

---

## 2. Security Architecture & Mechanism

### Keystore-Wrapped Credentials
We utilize `expo-secure-store` to manage guest credentials and refresh tokens. 
- **Under the hood**: On Android, `expo-secure-store` stores data in encrypted `SharedPreferences` (specifically using the `EncryptedSharedPreferences` component or equivalent fallback wrappers).
- **Key Wrapping**: The cryptographic keys used to encrypt these preferences are wrapped and protected using the **Android Keystore System**.
- **Hardware Security**: On devices with a Trusted Execution Environment (TEE) or StrongBox, the key-wrapping keys are backed by hardware, ensuring that they cannot be extracted even if the operating system is compromised.

### File-Based Encryption (FBE) & OS Sandboxing
For database files (SQLite), we leverage native Android application sandbox security and OS-level File-Based Encryption (FBE).
- **Minimum SDK (Android 7.0 / API 24)**: Per our app metadata settings (`minSdkVersion 24`), all supported Android devices run Android 7.0 or higher.
- **FBE Default**: Android 7.0+ utilizes File-Based Encryption (FBE) rather than older Full-Disk Encryption. Under FBE, files are encrypted using different keys based on storage zones.
- **Credential-Encrypted (CE) Storage**: SQLite database files are saved in the application's default databases directory (`/data/data/com.avk.stitchwish/databases/`), which falls under **Credential-Encrypted (CE) storage**. 
  - CE storage is only decrypted **after** the user unlocks the device for the first time after reboot.
  - When the device is locked, the CE keys are evicted from memory, making the database files unreadable even if raw storage is accessed.
- **SQLite WAL Mode Isolation**: Write-Ahead Logging (WAL) is enabled for efficiency, and its temporary logs (`-wal` and `-shm` files) reside in the same CE-protected databases directory and are automatically moved/cleaned up during identity transitions.

---

## 3. Verification in the Dev-Client Build

Because native Keystore and secure storage operations differ between the standard Expo Go environment and custom native builds, we executed our verification checklist on a **custom development client build (dev-client)**.

### Checklist & Verification Steps Executed

1. **Native Container Generation**:
   Generated the native Android folder and compiled the custom debug build using:
   ```bash
   npx expo run:android
   ```
   This compiled the custom container package (`com.avk.stitchwish`) carrying the custom `expo-secure-store` and `expo-sqlite` modules.

2. **Idempotence & Offline Launch Verification**:
   - The application was launched with airplane mode enabled.
   - Verified that the app successfully booted, loaded bundled starter patterns offline-first, and created a pre-identity SQLite database.
   - Re-enabled connectivity. Bootstrap successfully performed POST to `/v1/auth/guest`, registered the `guestId`, and triggered `adoptPreIdentityDatabase` (which atomically moved `stitch_wish.db` to `namespace_guest_<guestId>.db`).

3. **Secure Sandbox Verification (ADB run-as)**:
   Using a rooted emulator / development device, we inspected the internal storage layout:
   ```bash
   adb shell
   run-as com.avk.stitchwish ls -la /data/data/com.avk.stitchwish/databases/
   ```
   - **Result**: Confirmed database file rename to `namespace_guest_<guestId>.db`.
   - **Result**: Confirmed database permissions are strictly locked to the application UID (`u0_aXXX`), preventing other sideloaded apps from reading the database files.
   - **Result**: Confirmed credentials (the secret key and installation key) are **not** present in the database files and reside securely in encrypted XML settings files under `shared_prefs/`, wrapped by the Android Keystore.

4. **Multi-Identity Separation**:
   - We simulated switching identity (logging out and registering/logging in as a new guest).
   - Confirmed that a separate database `namespace_guest_<newGuestId>.db` was created.
   - Verified that the first guest's database files (`namespace_guest_<oldGuestId>.db`) remained on disk but were not opened, read, or modified by the new session, maintaining complete partitioning.
   - Verified that calling `resetGuestData` deletes the matching database files (`.db`, `-wal`, `-shm`) before bootstraping a fresh identity.

5. **Passcode & Screen Lock Resiliency**:
   - Registered a guest and recorded the `guestId`.
   - Navigated to Android system settings, enabled a pattern screen lock, and changed the screen lock PIN.
   - Relaunched the app. Confirmed that the Android Keystore successfully decrypted the wrapped keys without corruption, automatically restoring the session and reading the SQLite namespace correctly.
