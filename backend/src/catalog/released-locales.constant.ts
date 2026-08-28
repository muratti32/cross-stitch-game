// Keep this cohort in sync with the mobile app's released App Display Languages.
// The cross-cutting parity gate is tracked separately in issue #173.
export const RELEASED_APP_DISPLAY_LOCALES = ['en', 'tr'] as const;
export type ReleasedAppDisplayLocale = (typeof RELEASED_APP_DISPLAY_LOCALES)[number];
