import { getSurfaceKey, isCacheStale, getCacheKey, localeCacheLookupOrder } from '../catalog-cache-logic';

describe('Offline Catalog Cache logic', () => {
  describe('getSurfaceKey', () => {
    test('returns the bare endpoint when there are no params', () => {
      expect(getSurfaceKey('/v1/catalog/staff-picks', {})).toBe(
        '/v1/catalog/staff-picks',
      );
    });

    test('sorts params so equivalent requests share one surface', () => {
      const a = getSurfaceKey('/v1/catalog/patterns', {
        limit: 10,
        category: 'animals',
      });
      const b = getSurfaceKey('/v1/catalog/patterns', {
        category: 'animals',
        limit: 10,
      });
      expect(a).toBe(b);
      expect(a).toBe('/v1/catalog/patterns?category=animals&limit=10');
    });

    test('drops undefined and null params', () => {
      expect(
        getSurfaceKey('/v1/catalog/patterns', {
          category: undefined,
          tag: null,
          limit: 10,
        }),
      ).toBe('/v1/catalog/patterns?limit=10');
    });
  });

  // #160: the persisted cache key incorporates the locale so a language
  // change can never surface the previous locale's labels as the current
  // ones, while still letting an offline player fall back to whatever
  // locale's payload is already cached (CONTEXT.md's Connectivity State).
  describe('getCacheKey', () => {
    test('two locales for the same surface do not collide', () => {
      const surfaceKey = getSurfaceKey('/v1/catalog/tags', {});
      expect(getCacheKey(surfaceKey, 'en')).not.toBe(getCacheKey(surfaceKey, 'tr'));
    });

    test('the same surface and locale always derive the same key', () => {
      const surfaceKey = getSurfaceKey('/v1/catalog/categories', {});
      expect(getCacheKey(surfaceKey, 'tr')).toBe(getCacheKey(surfaceKey, 'tr'));
    });

    test('a language change does not resolve to the previous locale key', () => {
      const surfaceKey = getSurfaceKey('/v1/catalog/categories', {});
      const previousKey = getCacheKey(surfaceKey, 'en');
      const currentKey = getCacheKey(surfaceKey, 'tr');
      expect(currentKey).not.toBe(previousKey);
    });
  });

  describe('localeCacheLookupOrder', () => {
    test('tries the active locale first', () => {
      expect(localeCacheLookupOrder('tr', ['en', 'tr'])).toEqual(['tr', 'en']);
    });

    test('still includes every supported locale when the active one leads', () => {
      expect(localeCacheLookupOrder('en', ['en', 'tr'])).toEqual(['en', 'tr']);
    });
  });

  describe('isCacheStale', () => {
    const now = new Date('2026-07-14T12:00:00.000Z');

    test('fresh entries are not stale', () => {
      expect(isCacheStale('2026-07-14T11:58:00.000Z', 5 * 60 * 1000, now)).toBe(
        false,
      );
    });

    test('entries older than the max age are stale', () => {
      expect(isCacheStale('2026-07-14T11:00:00.000Z', 5 * 60 * 1000, now)).toBe(
        true,
      );
    });

    test('future timestamps are treated as stale', () => {
      expect(isCacheStale('2026-07-14T13:00:00.000Z', 5 * 60 * 1000, now)).toBe(
        true,
      );
    });

    test('unparseable timestamps are treated as stale', () => {
      expect(isCacheStale('not-a-date', 5 * 60 * 1000, now)).toBe(true);
    });
  });
});
