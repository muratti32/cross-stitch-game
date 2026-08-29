export const CANDIDATE_APP_DISPLAY_LOCALES = ['en', 'tr', 'es', 'de', 'fr', 'pt-BR', 'it', 'ar', 'ja', 'ko'] as const;
export type CandidateAppDisplayLocale = (typeof CANDIDATE_APP_DISPLAY_LOCALES)[number];
