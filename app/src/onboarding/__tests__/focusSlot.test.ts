import { createFocusSlot } from '../focusSlot';

it('allows only the current focus owner to release the shared slot', () => {
  const slot = createFocusSlot();
  slot.acquire('tutorial');
  slot.acquire('locator');
  expect(slot.release('tutorial')).toBe(false);
  expect(slot.currentOwner()).toBe('locator');
  expect(slot.release('locator')).toBe(true);
  expect(slot.currentOwner()).toBeNull();
});
