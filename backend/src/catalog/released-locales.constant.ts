// Keep this cohort in sync with the mobile app's released App Display Languages.
// The cross-cutting parity gate is tracked separately in issue #173.
export const RELEASED_APP_DISPLAY_LOCALES = [
  'ar', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'hi', 'hr', 'hu', 'id', 'it', 'ja',
  'ko', 'ms', 'nb', 'nl', 'pl', 'pt', 'pt-BR', 'ro', 'ru', 'sk', 'sl', 'sv', 'tl', 'tr', 'uk', 'vi',
  'zh-Hans', 'zh-Hant',
] as const;
export type ReleasedAppDisplayLocale = (typeof RELEASED_APP_DISPLAY_LOCALES)[number];
