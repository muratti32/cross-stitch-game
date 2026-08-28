const DEFAULT_AI_PATTERN_TITLE = 'My AI Pattern';

export function normalizePersonalPatternTitle(title: string): string {
  return title.trim().toLocaleLowerCase();
}

/**
 * `baseTitle` defaults to the English `DEFAULT_AI_PATTERN_TITLE` so existing
 * callers (and patternTitle.test.ts, which asserts that literal) keep
 * working unchanged; the AI generation screen (#168) passes its localized
 * default title instead so a Turkish-reading player sees a Turkish
 * suggestion while this function's dedup algorithm stays language-agnostic.
 */
export function suggestAiPatternTitle(
  titles: Iterable<string>,
  baseTitle: string = DEFAULT_AI_PATTERN_TITLE,
): string {
  const normalizedTitles = new Set(
    Array.from(titles, normalizePersonalPatternTitle),
  );

  if (!normalizedTitles.has(normalizePersonalPatternTitle(baseTitle))) {
    return baseTitle;
  }

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${baseTitle} ${suffix}`;
    if (!normalizedTitles.has(normalizePersonalPatternTitle(candidate))) {
      return candidate;
    }
  }
}
