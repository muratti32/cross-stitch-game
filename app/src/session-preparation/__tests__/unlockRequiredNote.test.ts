import { catalogDetailRoute, isUnlockRequiredNote } from '../unlockRequiredRoute';

describe('unlockRequiredRoute', () => {
  test('recognises only the unlock_required error note', () => {
    expect(isUnlockRequiredNote('unlock_required')).toBe(true);
    expect(isUnlockRequiredNote('Failed to refresh grant: 500')).toBe(false);
    expect(isUnlockRequiredNote(null)).toBe(false);
    expect(isUnlockRequiredNote(undefined)).toBe(false);
  });

  test('routes to the catalog detail of the pattern', () => {
    expect(catalogDetailRoute('pattern-1')).toEqual({
      pathname: '/(tabs)/(catalog)/[id]',
      params: { id: 'pattern-1' },
    });
  });
});
