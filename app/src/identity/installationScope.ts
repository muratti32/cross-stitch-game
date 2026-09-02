import * as FileSystem from 'expo-file-system/legacy';
import type { SessionEnvelope } from './sessionEnvelope';

/**
 * Lives in the app sandbox rather than SecureStore on purpose: the sandbox is
 * erased when the app is deleted, so its absence is what identifies a fresh
 * installation.
 */
export const INSTALLATION_MARKER_FILENAME = 'installation.v1';

/**
 * iOS keeps Keychain items when an app is deleted, so a freshly installed app
 * can read a session envelope written by a previous installation. Everything
 * that envelope pointed at is gone - the local database and every Local
 * Identity Namespace it scoped - and `requiresSignIn` is the one state a
 * player cannot leave without authenticating. A new player must reach the
 * Welcome flow as a Guest Player, so a fresh installation never inherits it.
 *
 * A usable inherited session is deliberately kept: staying signed in across a
 * reinstall is correct, and a Guest Installation Identity that can still be
 * reissued from the retained installation credentials keeps its Guest Ledger.
 */
export function shouldDiscardInheritedSession(
  installationMarkerPresent: boolean,
  envelope: SessionEnvelope,
): boolean {
  return !installationMarkerPresent && envelope.requiresSignIn;
}

export interface InstallationMarkerStore {
  isPresent(): Promise<boolean>;
  persist(): Promise<void>;
}

function markerPath(): string | null {
  const documentDirectory = FileSystem.documentDirectory;
  return documentDirectory === null ? null : `${documentDirectory}${INSTALLATION_MARKER_FILENAME}`;
}

export const installationMarkerStore: InstallationMarkerStore = {
  /**
   * Reports the marker as present when it cannot be read. A storage failure
   * must never be mistaken for a fresh installation, because that would
   * discard a real player's sign-in gate.
   */
  async isPresent(): Promise<boolean> {
    const path = markerPath();
    if (path === null) return true;
    try {
      return (await FileSystem.getInfoAsync(path)).exists;
    } catch {
      return true;
    }
  },

  async persist(): Promise<void> {
    const path = markerPath();
    if (path === null) return;
    try {
      await FileSystem.writeAsStringAsync(path, new Date().toISOString());
    } catch {
      // A marker that cannot be written is retried on the next startup. The
      // reconciliation it guards is idempotent, so a repeat is harmless.
    }
  },
};
