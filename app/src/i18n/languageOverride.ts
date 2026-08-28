/**
 * Thin adapter around the device-local config store for the player's App
 * Display Language override. This is a device preference (CONTEXT.md),
 * never account data and never synced - it lives in the same per-device
 * `device_config` table as the existing handedness preference, not on the
 * Registered Account or any synced store.
 */
import { getDeviceConfigValue, setDeviceConfigValue, deleteDeviceConfigValue } from '../local-db';

const LANGUAGE_OVERRIDE_KEY = 'app_language_override';

/** The player's stored language override, or null if none is set. */
export async function getLanguageOverride(): Promise<string | null> {
  return getDeviceConfigValue(LANGUAGE_OVERRIDE_KEY);
}

/** Stores the player's chosen language override on this device only. */
export async function setLanguageOverride(locale: string): Promise<void> {
  await setDeviceConfigValue(LANGUAGE_OVERRIDE_KEY, locale);
}

/** Clears the override so resolution follows the device language again. */
export async function clearLanguageOverride(): Promise<void> {
  await deleteDeviceConfigValue(LANGUAGE_OVERRIDE_KEY);
}
