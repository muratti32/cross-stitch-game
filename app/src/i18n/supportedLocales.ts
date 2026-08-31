/**
 * The locales the app binary bundles translations for and exposes to
 * players (#155: English and Turkish for the first release; see #169-185
 * for the seven-locale expansion). A locale folder existing under
 * `locales/` (and therefore an entry in resources.generated.json) means a
 * *candidate* pack has been prepared for review - it does NOT by itself
 * mean the locale is released. RELEASED_APP_DISPLAY_LOCALES is the
 * explicit release list (mirrors backend/src/catalog/released-locales.constant.ts;
 * keep both in sync - the cross-cutting parity gate is issue #173) and is
 * the only thing that gates what SUPPORTED_LOCALES/players actually see.
 */
import resources from './resources.generated.json';
import { APP_LOCALE_CATALOG, type AppLocale } from './localeCatalog';

/** Explicitly released locales. Adding a locale here is the activation step (#184). */
export const RELEASED_APP_DISPLAY_LOCALES = [
  'ar', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'hi', 'hr', 'hu', 'id', 'it', 'ja',
  'ko', 'ms', 'nb', 'nl', 'pl', 'pt', 'pt-BR', 'ro', 'ru', 'sk', 'sl', 'sv', 'tl', 'tr', 'uk', 'vi',
  'zh-Hans', 'zh-Hant',
] as const;
type ReleasedAppDisplayLocale = (typeof RELEASED_APP_DISPLAY_LOCALES)[number];

export type SupportedLocale = Extract<keyof typeof resources, AppLocale> & ReleasedAppDisplayLocale;
type SupportedLocaleCatalogEntry = Extract<(typeof APP_LOCALE_CATALOG)[number], { identifier: SupportedLocale }>;

export const SUPPORTED_LOCALES = Object.keys(resources).filter((identifier): identifier is SupportedLocale =>
  (RELEASED_APP_DISPLAY_LOCALES as readonly string[]).includes(identifier),
);

export const SUPPORTED_LOCALE_CATALOG = APP_LOCALE_CATALOG.filter((locale): locale is SupportedLocaleCatalogEntry =>
  SUPPORTED_LOCALES.includes(locale.identifier as SupportedLocale),
);
