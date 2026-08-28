/**
 * Pure resolution of the App Display Language (CONTEXT.md). Takes no I/O:
 * reading the device language and reading/writing the stored override are
 * separate thin adapters (see deviceLanguages.ts and languageOverride.ts)
 * built around this function.
 */

/** English is the reference key set and the product's fixed fallback. */
export const FALLBACK_LOCALE = 'en';

function canonicalizeLanguageTag(tag: string): string | null {
  try {
    return Intl.getCanonicalLocales(tag.replace(/_/g, '-'))[0] ?? null;
  } catch {
    return null;
  }
}

function resolveCandidate(candidate: string, supportedLocales: readonly string[]): string | null {
  const canonicalCandidate = canonicalizeLanguageTag(candidate);
  if (canonicalCandidate === null) {
    return null;
  }

  const canonicalSupported = supportedLocales.map((locale) => ({
    locale,
    canonical: canonicalizeLanguageTag(locale),
  }));
  const exact = canonicalSupported.find(({ canonical }) => canonical === canonicalCandidate);
  if (exact) {
    return exact.locale;
  }

  const baseLanguage = canonicalCandidate.split('-')[0].toLowerCase();
  return canonicalSupported.find(({ canonical }) => canonical?.toLowerCase() === baseLanguage)?.locale ?? null;
}

/**
 * Resolves the active App Display Language from the ordered device
 * languages, an optional stored override, and the list of locales the app
 * bundles translations for.
 *
 * - A supported, non-null override wins outright, using exact then base match.
 * - Otherwise the first supported device language wins in device preference
 *   order, using exact then base match.
 * - An absent/empty device language list, or no supported language found
 *   anywhere above, resolves to English.
 */
export function resolveAppLanguage(
  deviceLanguages: readonly string[],
  override: string | null,
  supportedLocales: readonly string[],
): string {
  if (override !== null) {
    const resolvedOverride = resolveCandidate(override, supportedLocales);
    if (resolvedOverride !== null) {
      return resolvedOverride;
    }
  }

  for (const deviceLanguage of deviceLanguages) {
    const resolvedDeviceLanguage = resolveCandidate(deviceLanguage, supportedLocales);
    if (resolvedDeviceLanguage !== null) {
      return resolvedDeviceLanguage;
    }
  }

  return FALLBACK_LOCALE;
}
