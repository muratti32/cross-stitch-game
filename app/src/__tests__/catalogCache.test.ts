import { getSurfaceKey, isCacheStale } from '../catalog-cache-logic';

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
