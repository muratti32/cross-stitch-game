const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Catalog pattern ids are UUIDs; anything else can never name a server pattern. */
export function isCatalogPatternId(id: string): boolean {
  return UUID.test(id);
}

/** Detail route segment for an id that names no pattern; the screen shows its unavailable state. */
export const UNAVAILABLE_PATTERN_SEGMENT = 'unavailable';
