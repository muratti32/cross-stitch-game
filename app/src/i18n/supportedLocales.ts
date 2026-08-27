/**
 * The locales the app binary bundles translations for (#155: English and
 * Turkish for the first release). Adding a third language means adding a
 * locale folder under `locales/` and this code, and nothing else - it is
 * pure content work.
 */
export const SUPPORTED_LOCALES = ['en', 'tr'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
