/**
 * The locales the app binary bundles translations for (#155: English and
 * Turkish for the first release). The staged identifier/self-name catalog is
 * kept separately; only identifiers present in generated resources are
 * released to the app.
 */
import resources from './resources.generated.json';
import { APP_LOCALE_CATALOG, type AppLocale } from './localeCatalog';

export type SupportedLocale = Extract<keyof typeof resources, AppLocale>;
type SupportedLocaleCatalogEntry = Extract<(typeof APP_LOCALE_CATALOG)[number], { identifier: SupportedLocale }>;

export const SUPPORTED_LOCALES = Object.keys(resources).filter((identifier): identifier is SupportedLocale =>
  APP_LOCALE_CATALOG.some((locale) => locale.identifier === identifier),
);

export const SUPPORTED_LOCALE_CATALOG = APP_LOCALE_CATALOG.filter((locale): locale is SupportedLocaleCatalogEntry =>
  SUPPORTED_LOCALES.includes(locale.identifier as SupportedLocale),
);
