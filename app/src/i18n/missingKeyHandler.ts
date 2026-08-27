/**
 * Wires into i18next's `parseMissingKeyHandler` / `missingKeyHandler` hooks
 * (see i18n.ts) to satisfy two guarantees from #155/#157:
 *
 *  - A missing key renders the English string, never a raw translation key.
 *  - A missing key is reported to Sentry at low volume (a breadcrumb, not an
 *    error event) as a signal for developers without alerting on it.
 */
/**
 * Decides what to render when a translation key is missing for the active
 * language. `englishFallback` is i18next's own computed fallback (it has
 * `fallbackLng: 'en'` configured), so this is already the English string
 * when one exists. The raw key itself is never an acceptable return value.
 */
export function resolveMissingTranslation(
  _key: string,
  englishFallback: string | undefined,
): string {
  return englishFallback ?? '';
}

/**
 * Reports a missing translation key as breadcrumb-level Sentry signal. Never
 * throws and never raises a Sentry error event - a translation gap degrades
 * gracefully (see resolveMissingTranslation) and should not look like a
 * crash.
 */
export function reportMissingTranslationKey(
  namespace: string,
  key: string,
  language: string,
): void {
  // Required lazily, not statically, so i18n bootstrap (loaded eagerly by
  // jest.setup.js for every suite - see #157's Jest setup decision) never
  // pulls in the real @sentry/react-native package for suites that have no
  // reason to mock it. Suites that exercise this path mock the module the
  // same way src/observability/sentry.test.ts already does.
  const Sentry = require('@sentry/react-native') as typeof import('@sentry/react-native');
  Sentry.addBreadcrumb({
    category: 'i18n',
    level: 'info',
    message: `Missing translation key: ${namespace}:${key}`,
    data: { namespace, key, language },
  });
}
