/** Canonical staged App Display Language catalog. */
export const APP_LOCALE_CATALOG = [
  { identifier: 'en', selfName: 'English', englishName: 'English', flag: '🇺🇸' },
  { identifier: 'tr', selfName: 'Türkçe', englishName: 'Turkish', flag: '🇹🇷' },
  { identifier: 'es', selfName: 'Español', englishName: 'Spanish', flag: '🇪🇸' },
  { identifier: 'de', selfName: 'Deutsch', englishName: 'German', flag: '🇩🇪' },
  { identifier: 'fr', selfName: 'Français', englishName: 'French', flag: '🇫🇷' },
  { identifier: 'pt-BR', selfName: 'Português (Brasil)', englishName: 'Portuguese (Brazil)', flag: '🇧🇷' },
  { identifier: 'it', selfName: 'Italiano', englishName: 'Italian', flag: '🇮🇹' },
  { identifier: 'ar', selfName: 'العربية', englishName: 'Arabic', flag: '🇸🇦' },
  { identifier: 'ja', selfName: '日本語', englishName: 'Japanese', flag: '🇯🇵' },
  { identifier: 'ko', selfName: '한국어', englishName: 'Korean', flag: '🇰🇷' },
  { identifier: 'nl', selfName: 'Nederlands', englishName: 'Dutch', flag: '🇳🇱' },
  { identifier: 'pl', selfName: 'Polski', englishName: 'Polish', flag: '🇵🇱' },
  { identifier: 'ru', selfName: 'Русский', englishName: 'Russian', flag: '🇷🇺' },
] as const;

export type AppLocale = (typeof APP_LOCALE_CATALOG)[number]['identifier'];

export function getLocaleSelfName(identifier: AppLocale | string): string {
  return APP_LOCALE_CATALOG.find((locale) => locale.identifier === identifier)?.selfName ?? identifier;
}

export function getLocaleEnglishName(identifier: AppLocale | string): string {
  return APP_LOCALE_CATALOG.find((locale) => locale.identifier === identifier)?.englishName ?? identifier;
}

export function getLocaleFlag(identifier: AppLocale | string): string {
  return APP_LOCALE_CATALOG.find((locale) => locale.identifier === identifier)?.flag ?? '🌐';
}
