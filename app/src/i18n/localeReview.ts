import type { AppLocale } from './localeCatalog';

export interface LocaleReviewState { nativeSpeakerReviewed: boolean; sensitiveCopyReviewed: boolean; }
export type LocaleReviewManifest = Readonly<Record<AppLocale, LocaleReviewState>>;
export interface ReviewViolation { locale: string; reason: string; }

export function validateLocaleReviewManifest(locales: readonly string[], manifest: Partial<Record<string, LocaleReviewState>>): ReviewViolation[] {
  return locales.flatMap((locale) => {
    const state = manifest[locale];
    if (!state) return [{ locale, reason: 'missing review manifest entry' }];
    return [
      !state.nativeSpeakerReviewed && { locale, reason: 'native-speaker review incomplete' },
      !state.sensitiveCopyReviewed && { locale, reason: 'sensitive-copy second review incomplete' },
    ].filter(Boolean) as ReviewViolation[];
  });
}
