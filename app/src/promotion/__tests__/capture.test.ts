import { captureGuestPromotion } from '../capture';
import type { HandoffStore } from '../handoffStore';
import type { PromotionHandoff } from '../handoff';
import type { GuestCapture } from '../manifest';
import { ACCOUNT_ID, base, captured, GUEST_ID, preview } from './fixtures';

jest.mock('../../local-db', () => ({}));
jest.mock('expo-crypto', () => ({}));

interface MemoryStore extends HandoffStore {
  current: PromotionHandoff | null;
}

function memoryStore(initial: PromotionHandoff | null = null): MemoryStore {
  const store: MemoryStore = {
    current: initial,
    load: jest.fn(async (): Promise<PromotionHandoff | null> => store.current),
    save: jest.fn(async (handoff: PromotionHandoff): Promise<void> => {
      store.current = handoff;
    }),
    clear: jest.fn(async (): Promise<void> => {
      store.current = null;
    }),
  };
  return store;
}

const capture = (): GuestCapture => {
  const { manifest, manifestChecksum, drain } = base();
  return { manifest, manifestChecksum, drain };
};

describe('captureGuestPromotion', () => {
  test('persists a captured handoff for the Guest and the target account', async () => {
    const store = memoryStore();
    const read = jest.fn(async () => capture());

    await captureGuestPromotion(GUEST_ID, ACCOUNT_ID, store, read);

    expect(read).toHaveBeenCalledWith(GUEST_ID);
    expect(store.current).toEqual({ phase: 'captured', guestId: GUEST_ID, accountId: ACCOUNT_ID, ...capture() });
  });

  test('replaces an unfinished pre-commit handoff with a fresh capture', async () => {
    const store = memoryStore({ ...base(), phase: 'disclosing', preview: preview(), notice: null });

    await captureGuestPromotion(GUEST_ID, ACCOUNT_ID, store, async () => capture());

    expect(store.current).toMatchObject({ phase: 'captured' });
  });

  test.each(['syncing', 'needsAttention'] as const)('never replaces a %s handoff that still owns unacknowledged items', async (phase) => {
    const existing: PromotionHandoff = { ...base(), phase, promotionMode: 'economy', acked: { likes: [], sessions: [] } };
    const store = memoryStore(existing);
    const read = jest.fn(async () => capture());

    await captureGuestPromotion(GUEST_ID, ACCOUNT_ID, store, read);

    expect(store.current).toBe(existing);
    expect(read).not.toHaveBeenCalled();
  });

  test('a failing read persists nothing and propagates', async () => {
    const store = memoryStore(captured());

    await expect(
      captureGuestPromotion(GUEST_ID, ACCOUNT_ID, store, async () => {
        throw new Error('db closed');
      }),
    ).rejects.toThrow('db closed');
    expect(store.save).not.toHaveBeenCalled();
  });
});
