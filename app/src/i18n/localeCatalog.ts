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
  { identifier: 'zh-Hans', selfName: '简体中文', englishName: 'Simplified Chinese', flag: '🇨🇳' },
  { identifier: 'zh-Hant', selfName: '繁體中文', englishName: 'Traditional Chinese', flag: '🇹🇼' },
  { identifier: 'ca', selfName: 'Català', englishName: 'Catalan', flag: '🇪🇸' },
  { identifier: 'cs', selfName: 'Čeština', englishName: 'Czech', flag: '🇨🇿' },
  { identifier: 'da', selfName: 'Dansk', englishName: 'Danish', flag: '🇩🇰' },
  { identifier: 'el', selfName: 'Ελληνικά', englishName: 'Greek', flag: '🇬🇷' },
  { identifier: 'fi', selfName: 'Suomi', englishName: 'Finnish', flag: '🇫🇮' },
  { identifier: 'hi', selfName: 'हिन्दी', englishName: 'Hindi', flag: '🇮🇳' },
  { identifier: 'hr', selfName: 'Hrvatski', englishName: 'Croatian', flag: '🇭🇷' },
  { identifier: 'hu', selfName: 'Magyar', englishName: 'Hungarian', flag: '🇭🇺' },
  { identifier: 'id', selfName: 'Bahasa Indonesia', englishName: 'Indonesian', flag: '🇮🇩' },
  { identifier: 'ms', selfName: 'Bahasa Melayu', englishName: 'Malay', flag: '🇲🇾' },
  { identifier: 'nb', selfName: 'Norsk Bokmål', englishName: 'Norwegian Bokmål', flag: '🇳🇴' },
  { identifier: 'pt', selfName: 'Português', englishName: 'Portuguese (Portugal)', flag: '🇵🇹' },
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
