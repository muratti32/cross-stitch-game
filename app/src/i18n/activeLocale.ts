/**
 * Reads the currently active App Display Language from the i18next runtime,
 * for app-authored code that needs the current locale outside a React
 * render - the shared API client attaching it to catalog requests, and the
 * Offline Catalog Cache key (#160). Kept separate from languageResolution.ts
 * so this stays free of local-db/expo-sqlite (see i18n.ts's own comment on
 * why that import must not land here).
 */
import i18n from './i18n';
import { FALLBACK_LOCALE } from './resolveAppLanguage';

export function getActiveLocale(): string {
  return i18n.language || FALLBACK_LOCALE;
}
