/**
 * Pure resolution of the App Display Language (CONTEXT.md). Takes no I/O:
 * reading the device language and reading/writing the stored override are
 * separate thin adapters (see deviceLanguages.ts and languageOverride.ts)
 * built around this function.
 */

/** English is the reference key set and the product's fixed fallback. */
export const FALLBACK_LOCALE = 'en';

/**
 * Normalizes a region-tagged language tag (e.g. 'tr-TR', 'tr_TR') to its
 * base language ('tr').
 */
function normalizeToBaseLanguage(tag: string): string {
  return tag.split(/[-_]/)[0].toLowerCase();
}

/**
 * Resolves the active App Display Language from the ordered device
 * languages, an optional stored override, and the list of locales the app
 * bundles translations for.
 *
 * - A supported, non-null override wins outright.
 * - Otherwise the first supported device language (after normalizing any
 *   region tag) wins, in device preference order.
 * - An absent/empty device language list, or no supported language found
 *   anywhere above, resolves to English.
 */
export function resolveAppLanguage(
  deviceLanguages: readonly string[],
  override: string | null,
  supportedLocales: readonly string[],
): string {
  if (override !== null) {
    const normalizedOverride = normalizeToBaseLanguage(override);
    if (supportedLocales.includes(normalizedOverride)) {
      return normalizedOverride;
    }
  }

  for (const deviceLanguage of deviceLanguages) {
    const normalized = normalizeToBaseLanguage(deviceLanguage);
    if (supportedLocales.includes(normalized)) {
      return normalized;
    }
  }

  return FALLBACK_LOCALE;
}
