import { isUnlockRequiredNote, UNLOCK_REQUIRED_NOTE } from '../unlockRequiredNote';

describe('unlockRequiredNote', () => {
  test('recognises only the unlock_required error note', () => {
    expect(isUnlockRequiredNote(UNLOCK_REQUIRED_NOTE)).toBe(true);
    expect(isUnlockRequiredNote('Failed to refresh grant: 500')).toBe(false);
    expect(isUnlockRequiredNote(null)).toBe(false);
    expect(isUnlockRequiredNote(undefined)).toBe(false);
  });
});
