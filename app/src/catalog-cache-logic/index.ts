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
