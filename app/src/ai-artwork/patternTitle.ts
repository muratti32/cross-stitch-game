const DEFAULT_AI_PATTERN_TITLE = 'My AI Pattern';

export function normalizePersonalPatternTitle(title: string): string {
  return title.trim().toLocaleLowerCase();
}

export function suggestAiPatternTitle(titles: Iterable<string>): string {
  const normalizedTitles = new Set(
    Array.from(titles, normalizePersonalPatternTitle),
  );

  if (
    !normalizedTitles.has(
      normalizePersonalPatternTitle(DEFAULT_AI_PATTERN_TITLE),
    )
  ) {
    return DEFAULT_AI_PATTERN_TITLE;
  }

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${DEFAULT_AI_PATTERN_TITLE} ${suffix}`;
    if (!normalizedTitles.has(normalizePersonalPatternTitle(candidate))) {
      return candidate;
    }
  }
}
