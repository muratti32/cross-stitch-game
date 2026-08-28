/**
 * The i18next runtime bootstrap (#155/#157). Resources are statically
 * imported and bundled into the app binary - no remote fetch, no OTA
 * translation channel - so the App Display Language resolves with no
 * network for a Guest Player who has never been online.
 *
 * Deliberately has no dependency on local-db/expo-sqlite (see
 * languageResolution.ts for the override-reading side): jest.setup.js
 * requires this module directly, for every suite, to initialize the real
 * i18next instance with real English resources (#157's Jest setup
 * decision). Pulling in the real expo-sqlite module that early would load
 * it before a test file's own `jest.mock('expo-sqlite', ...)` can take
 * effect, breaking local-db's own suites.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import resources from './resources.generated.json';
import { FALLBACK_LOCALE } from './resolveAppLanguage';
import { resolveMissingTranslation, reportMissingTranslationKey } from './missingKeyHandler';
import { SUPPORTED_LOCALES } from './supportedLocales';

export const DEFAULT_NAMESPACE = 'settings';

// One namespace per feature, mirroring the feature directories under src/.
// `errors` and `shell` are the exceptions: `errors` is not one screen's
// feature but the shared, cross-cutting backend-error presentation text
// from #159, reused by every error surface regardless of which
// localization slice that screen belongs to - see
// src/api/serverErrorPresentation.ts. `shell` (#166) is the app-shell chrome
// itself - the bottom tab bar titles in app/(tabs)/_layout.tsx - which has
// no single owning feature directory.
let initialized = false;

/**
 * Initializes the i18next runtime once, synchronously, with the bundled
 * English and Turkish resources. Call this as early as possible - before
 * anything renders translated text - same convention as initSentry().
 */
export function initI18n(): typeof i18n {
  if (initialized) {
    return i18n;
  }
  initialized = true;

  i18n.use(initReactI18next);
  i18n.init({
    resources,
    lng: FALLBACK_LOCALE,
    fallbackLng: FALLBACK_LOCALE,
    ns: Object.keys(resources.en),
    defaultNS: DEFAULT_NAMESPACE,
    supportedLngs: [...SUPPORTED_LOCALES],
    interpolation: { escapeValue: false },
    // All resources are preloaded above; this keeps init (and the first
    // render that depends on it) synchronous instead of deferred to a
    // setTimeout tick.
    initAsync: false,
    returnNull: false,
    returnEmptyString: false,
    saveMissing: true,
    missingKeyHandler: (languages, namespace, key) => {
      reportMissingTranslationKey(namespace, key, languages[0] ?? FALLBACK_LOCALE);
    },
    parseMissingKeyHandler: (key, defaultValue) => resolveMissingTranslation(key, defaultValue),
  });

  return i18n;
}

export default i18n;
