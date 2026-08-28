/** Canonical staged App Display Language catalog. */
export const APP_LOCALE_CATALOG = [
  { identifier: 'en', selfName: 'English' },
  { identifier: 'tr', selfName: 'Türkçe' },
  { identifier: 'es', selfName: 'Español' },
  { identifier: 'de', selfName: 'Deutsch' },
  { identifier: 'fr', selfName: 'Français' },
  { identifier: 'pt-BR', selfName: 'Português (Brasil)' },
  { identifier: 'it', selfName: 'Italiano' },
] as const;

export type AppLocale = (typeof APP_LOCALE_CATALOG)[number]['identifier'];

export function getLocaleSelfName(identifier: AppLocale): string {
  return APP_LOCALE_CATALOG.find((locale) => locale.identifier === identifier)?.selfName ?? identifier;
}
