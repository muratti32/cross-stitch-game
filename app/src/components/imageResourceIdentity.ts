const VOLATILE_GRANT_PARAMS = new Set(['exp', 'sig']);

/** Stable identity for one image whose short-lived access grant may rotate. */
export function imageResourceIdentity(uri: string): string {
  const queryIndex = uri.indexOf('?');
  if (queryIndex === -1) return uri;

  const path = uri.slice(0, queryIndex);
  const params = new URLSearchParams(uri.slice(queryIndex + 1));
  for (const param of VOLATILE_GRANT_PARAMS) params.delete(param);
  const stableQuery = params.toString();
  return stableQuery.length > 0 ? `${path}?${stableQuery}` : path;
}
