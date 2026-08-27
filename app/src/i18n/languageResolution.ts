/**
 * Resolves and applies the active App Display Language at runtime, wiring
 * together the pure resolver (resolveAppLanguage.ts), the device-language
 * adapter (deviceLanguages.ts), the override-persistence adapter
 * (languageOverride.ts, backed by local-db/expo-sqlite), and the i18next
 * instance (i18n.ts).
 *
 * Kept as its own module, separate from i18n.ts, so that initializing the
 * i18next runtime (which jest.setup.js does eagerly for every suite) never
 * has to load local-db/expo-sqlite as a side effect.
 */
import i18n from './i18n';
import { getDeviceLanguages } from './deviceLanguages';
import { getLanguageOverride, setLanguageOverride, clearLanguageOverride } from './languageOverride';
import { FALLBACK_LOCALE, resolveAppLanguage } from './resolveAppLanguage';
import { SUPPORTED_LOCALES } from './supportedLocales';
import { LANGUAGE_MIGRATION_GATE_OPEN } from './migrationGate';

/**
 * Resolves and applies the active App Display Language from the device
 * languages and any stored override, then re-renders the translated tree in
 * place - no app restart (#155).
 *
 * #157's migration gate: while LANGUAGE_MIGRATION_GATE_OPEN is false, the
 * active language stays pinned to English for every player regardless of
 * device language or a stored override. This still reads the override so
 * the underlying plumbing is exercised end-to-end; it just never acts on it
 * until #167 opens the gate.
 */
export async function applyResolvedLanguage(): Promise<void> {
  if (!LANGUAGE_MIGRATION_GATE_OPEN) {
    await i18n.changeLanguage(FALLBACK_LOCALE);
    return;
  }

  const [override, deviceLanguages] = [await getLanguageOverride(), getDeviceLanguages()];
  const resolved = resolveAppLanguage(deviceLanguages, override, SUPPORTED_LOCALES);
  await i18n.changeLanguage(resolved);
}

/**
 * Sets the player's language override and applies it immediately. The
 * Settings language picker that calls this is itself hidden behind the
 * migration gate (see migrationGate.ts and SettingsScreen), so this stays
 * correct and ready for when #167 opens it.
 */
export async function setActiveLanguageOverride(locale: string): Promise<void> {
  await setLanguageOverride(locale);
  await applyResolvedLanguage();
}

/** Clears the override and returns to following the device language. */
export async function clearActiveLanguageOverride(): Promise<void> {
  await clearLanguageOverride();
  await applyResolvedLanguage();
}
