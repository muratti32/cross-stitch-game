export function getSurfaceKey(
  endpoint: string,
  params: Record<string, string | number | undefined | null>
): string {
  const sortedParts = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null)
    .sort()
    .map((key) => `${key}=${params[key]}`);

  return sortedParts.length > 0 ? `${endpoint}?${sortedParts.join('&')}` : endpoint;
}

/**
 * Qualifies a surface key with the active App Display Language for Offline
 * Catalog Cache storage (#160). Kept separate from `getSurfaceKey` (which
 * also doubles as the request path sent to the backend) so the shared API
 * client's own locale attachment and this cache key never have to agree on
 * a single combined string - they derive the locale independently and only
 * happen to read the same source (see activeLocale.ts).
 */
export function getCacheKey(surfaceKey: string, locale: string): string {
  return `${surfaceKey}::locale=${locale}`;
}

/**
 * Orders the supported locales for a cache lookup: the active locale first,
 * then every other supported locale. On a cache miss under the active
 * locale (e.g. a player just switched language while offline), this lets
 * the caller fall back to whatever locale's payload is already cached
 * rather than blocking play - the previous locale's entries are abandoned,
 * not purged, per CONTEXT.md's Connectivity State.
 */
export function localeCacheLookupOrder(
  activeLocale: string,
  supportedLocales: readonly string[]
): string[] {
  return [
    activeLocale,
    ...supportedLocales.filter((locale) => locale !== activeLocale),
  ];
}

export function isCacheStale(
  fetchedAtIsoString: string,
  maxAgeMs: number = 5 * 60 * 1000,
  now: Date = new Date()
): boolean {
  const fetchedAtMs = new Date(fetchedAtIsoString).getTime();
  if (Number.isNaN(fetchedAtMs)) {
    return true;
  }
  const ageMs = now.getTime() - fetchedAtMs;
  return ageMs > maxAgeMs || ageMs < 0;
}
