/**
 * Thin adapter reading the device's ordered language preference list via
 * expo-localization. Resolves fully offline - no network, no Connectivity
 * State dependency (#155) - and feeds resolveAppLanguage.ts.
 */
import * as Localization from 'expo-localization';

/** The device's languages, most preferred first, as BCP-47 tags. */
export function getDeviceLanguages(): string[] {
  return Localization.getLocales().map((locale) => locale.languageTag);
}
