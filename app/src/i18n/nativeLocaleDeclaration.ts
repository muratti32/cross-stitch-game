export interface NativeLocaleViolation { locale: string; reason: 'not-declared' | 'unexpected-declared-locale'; }

export function compareNativeLocaleDeclarations(candidateLocales: readonly string[], declaredLocales: readonly string[]): NativeLocaleViolation[] {
  const candidate = new Set(candidateLocales); const declared = new Set(declaredLocales);
  return [
    ...candidateLocales.filter((locale) => !declared.has(locale)).map((locale) => ({ locale, reason: 'not-declared' as const })),
    ...declaredLocales.filter((locale) => !candidate.has(locale)).map((locale) => ({ locale, reason: 'unexpected-declared-locale' as const })),
  ];
}
