import { PromotionApiError, type PromotionPreviewResponse } from '../../api/promotionContract';
import type { PromotionHandoff } from '../handoff';
import type { HandoffStore } from '../handoffStore';
import { createPromotionRunner, type PromotionApi, type PromotionRunner } from '../promotionRunner';
import {
  ACCOUNT_ID,
  base,
  captured,
  emptyManifest,
  emptyPreview,
  GUEST_ID,
  PATTERN_A,
  PATTERN_B,
  preview,
  SESSION_A,
} from './fixtures';

interface MemoryStore extends HandoffStore {
  current: PromotionHandoff | null;
  writes: string[];
}

function memoryStore(initial: PromotionHandoff | null): MemoryStore {
  const store: MemoryStore = {
    current: initial,
    writes: [],
    load: async () => store.current,
    save: async (handoff) => {
      store.current = handoff;
      store.writes.push(handoff.phase);
    },
    clear: async () => {
      store.current = null;
      store.writes.push('cleared');
    },
  };
  return store;
}

const consumed = (): PromotionApiError => new PromotionApiError(409, 'guest_consumed', 'consumed');
const apiError = (status: number, code: string | null): PromotionApiError => new PromotionApiError(status, code, 'x');

interface Harness {
  runner: PromotionRunner;
  store: MemoryStore;
  api: { [K in keyof PromotionApi]: jest.Mock };
  returnToGuest: jest.Mock;
  markLike: jest.Mock;
  onEconomyChanged: jest.Mock;
  wait: jest.Mock;
}

function harness(initial: PromotionHandoff | null, overrides: Partial<Harness['api']> = {}, backoff: readonly number[] = [10, 20]): Harness {
  const store = memoryStore(initial);
  const api: Harness['api'] = {
    fetchPromotionPreview: jest.fn(async (): Promise<PromotionPreviewResponse> => preview()),
    lockPromotion: jest.fn(async () => ({ lockToken: 'lock-1', expiry: 'e' })),
    stagePromotionPackage: jest.fn(async () => ({ status: 'staged' as const, expiry: 'e' })),
    commitPromotion: jest.fn(async () => ({ status: 'committed' as const, promotionMode: 'economy' as const, replayed: false })),
    cancelPromotion: jest.fn(async () => undefined),
    drainLike: jest.fn(async () => undefined),
    drainSession: jest.fn(async () => undefined),
    ...overrides,
  };
  const returnToGuest = jest.fn(async () => undefined);
  const markLike = jest.fn(async () => undefined);
  const onEconomyChanged = jest.fn();
  const wait = jest.fn(async () => undefined);
  const runner = createPromotionRunner({
    store,
    api,
    readCredentialSecret: async () => 'secret',
    markLikeInAccountNamespace: markLike,
    returnToGuest,
    onEconomyChanged,
    wait,
    syncBackoffMs: backoff,
  });
  return { runner, store, api, returnToGuest, markLike, onEconomyChanged, wait };
}

const phase = (h: Harness): string | null => h.runner.getSnapshot().handoff?.phase ?? null;

describe('promotion runner', () => {
  test('previews, waits for the player, then locks, stages, commits and syncs to completion', async () => {
    const h = harness(captured());

    await h.runner.resume(ACCOUNT_ID);
    expect(phase(h)).toBe('disclosing');
    expect(h.api.fetchPromotionPreview).toHaveBeenCalledWith({
      guestId: GUEST_ID,
      guestCredential: 'secret',
      manifest: base().manifest,
      manifestChecksum: 'checksum-1',
    });
    expect(h.api.lockPromotion).not.toHaveBeenCalled();

    await h.runner.confirm();

    expect(h.api.lockPromotion).toHaveBeenCalledWith(preview(), 'sig');
    expect(h.api.stagePromotionPackage).toHaveBeenCalledWith({
      guestId: GUEST_ID,
      lockToken: 'lock-1',
      manifestChecksum: 'checksum-1',
      packageData: { manifest: base().manifest },
      checksum: 'checksum-1',
    });
    expect(h.api.commitPromotion).toHaveBeenCalledTimes(1);
    expect(h.api.drainLike).toHaveBeenCalledWith(GUEST_ID, PATTERN_B);
    expect(h.api.drainSession).toHaveBeenCalledWith(GUEST_ID, PATTERN_A, SESSION_A);
    expect(phase(h)).toBeNull();
    expect(h.store.current).toBeNull();
    expect(h.onEconomyChanged).toHaveBeenCalledTimes(2);
  });

  test('persists committing before any network call of the commit sequence', async () => {
    let phaseAtLock: string | null = null;
    const h = harness(captured(), {
      lockPromotion: jest.fn(async () => {
        phaseAtLock = h.store.current?.phase ?? null;
        return { lockToken: 'lock-1', expiry: 'e' };
      }),
    });
    await h.runner.resume(ACCOUNT_ID);

    await h.runner.confirm();

    expect(phaseAtLock).toBe('committing');
  });

  test('persists the commit step before the commit request leaves the device', async () => {
    let stepAtCommit: string | null = null;
    const h = harness(captured(), {
      commitPromotion: jest.fn(async () => {
        const stored = h.store.current;
        stepAtCommit = stored?.phase === 'committing' ? stored.step.kind : null;
        return { status: 'committed' as const, promotionMode: 'economy' as const, replayed: false };
      }),
    });
    await h.runner.resume(ACCOUNT_ID);

    await h.runner.confirm();

    expect(stepAtCommit).toBe('commit');
  });

  test('marks drained Likes on in the account namespace and never clears them', async () => {
    const h = harness(captured());
    await h.runner.resume(ACCOUNT_ID);

    await h.runner.confirm();

    expect(h.markLike).toHaveBeenCalledWith(PATTERN_B);
    expect(h.markLike).toHaveBeenCalledTimes(1);
  });

  test('an empty preview deletes the handoff without showing a screen or locking', async () => {
    const h = harness(captured({ manifest: emptyManifest(), drain: { likes: [], sessions: [] } }), {
      fetchPromotionPreview: jest.fn(async () => emptyPreview()),
    });
    const seen: Array<string | null> = [];
    h.runner.subscribe(() => seen.push(phase(h)));

    await h.runner.resume(ACCOUNT_ID);

    expect(phase(h)).toBeNull();
    expect(h.store.current).toBeNull();
    expect(seen).not.toContain('disclosing');
    expect(h.api.lockPromotion).not.toHaveBeenCalled();
  });

  test('guest_consumed at preview deletes the handoff', async () => {
    const h = harness(captured(), { fetchPromotionPreview: jest.fn(async () => { throw consumed(); }) });

    await h.runner.resume(ACCOUNT_ID);

    expect(phase(h)).toBeNull();
    expect(h.store.current).toBeNull();
    expect(h.runner.getSnapshot().failure).toBeNull();
  });

  test('a data-only commit result is carried into syncing', async () => {
    const h = harness(captured(), {
      fetchPromotionPreview: jest.fn(async () => preview({ promotionMode: 'data-only' })),
      commitPromotion: jest.fn(async () => ({ status: 'committed' as const, promotionMode: 'data-only' as const, replayed: false })),
      drainLike: jest.fn(async () => { throw apiError(503, null); }),
    });
    await h.runner.resume(ACCOUNT_ID);

    await h.runner.confirm();

    expect(h.runner.getSnapshot().handoff).toMatchObject({ phase: 'needsAttention', promotionMode: 'data-only' });
  });

  describe('cancel', () => {
    test('from disclosure signs back in as the Guest without touching the backend lock', async () => {
      const h = harness(captured());
      await h.runner.resume(ACCOUNT_ID);

      await h.runner.cancel();

      expect(h.api.cancelPromotion).not.toHaveBeenCalled();
      expect(h.returnToGuest).toHaveBeenCalledTimes(1);
      expect(phase(h)).toBeNull();
      expect(h.store.current).toBeNull();
    });

    test('while staging releases the lock first, then returns to the Guest', async () => {
      const order: string[] = [];
      const h = harness(captured(), {
        stagePromotionPackage: jest.fn(async () => { throw apiError(503, null); }),
        cancelPromotion: jest.fn(async () => { order.push('cancelPromotion'); }),
      });
      h.returnToGuest.mockImplementation(async () => { order.push('returnToGuest'); });
      await h.runner.resume(ACCOUNT_ID);
      await h.runner.confirm();
      expect(h.runner.getSnapshot().failure).not.toBeNull();

      await h.runner.cancel();

      expect(order).toEqual(['cancelPromotion', 'returnToGuest']);
      expect(h.store.current).toBeNull();
    });

    test('still returns to the Guest when releasing the lock fails', async () => {
      const h = harness(captured(), {
        stagePromotionPackage: jest.fn(async () => { throw apiError(503, null); }),
        cancelPromotion: jest.fn(async () => { throw new Error('offline'); }),
      });
      await h.runner.resume(ACCOUNT_ID);
      await h.runner.confirm();

      await h.runner.cancel();

      expect(h.returnToGuest).toHaveBeenCalledTimes(1);
      expect(h.store.current).toBeNull();
    });

    test('is ignored once the commit step was reached', async () => {
      const h = harness(captured(), { commitPromotion: jest.fn(async () => { throw apiError(503, null); }) });
      await h.runner.resume(ACCOUNT_ID);
      await h.runner.confirm();
      expect(h.store.current).toMatchObject({ phase: 'committing', step: { kind: 'commit' } });

      await h.runner.cancel();

      expect(h.returnToGuest).not.toHaveBeenCalled();
      expect(h.api.cancelPromotion).not.toHaveBeenCalled();
      expect(h.store.current).toMatchObject({ phase: 'committing' });
    });

    test('keeps the handoff and reports a failure when the Guest session cannot be restored', async () => {
      const h = harness(captured());
      h.returnToGuest.mockRejectedValue(new Error('boom'));
      await h.runner.resume(ACCOUNT_ID);

      await h.runner.cancel();

      expect(phase(h)).toBe('disclosing');
      expect(h.runner.getSnapshot().failure).toMatchObject({ key: 'unexpected' });
    });
  });

  describe('commit outcomes', () => {
    const rejectCommitOnce = (error: PromotionApiError) =>
      jest
        .fn()
        .mockRejectedValueOnce(error)
        .mockResolvedValue({ status: 'committed' as const, promotionMode: 'economy' as const, replayed: false });

    test('promotion_stale goes back to a fresh preview with a stale notice and waits for confirmation', async () => {
      const h = harness(captured(), {
        commitPromotion: rejectCommitOnce(apiError(409, 'promotion_stale')),
        fetchPromotionPreview: jest
          .fn()
          .mockResolvedValueOnce(preview())
          .mockResolvedValueOnce(preview({ promotionMode: 'data-only' })),
      });
      await h.runner.resume(ACCOUNT_ID);

      await h.runner.confirm();

      expect(h.runner.getSnapshot().handoff).toMatchObject({
        phase: 'disclosing',
        notice: 'stale',
        preview: { promotionMode: 'data-only' },
      });
      expect(h.api.commitPromotion).toHaveBeenCalledTimes(1);

      await h.runner.confirm();
      expect(h.api.commitPromotion).toHaveBeenCalledTimes(2);
      expect(phase(h)).toBeNull();
    });

    test.each(['promotion_lock_expired', 'preview_expired'])('%s previews again without a notice', async (code) => {
      const h = harness(captured(), { commitPromotion: rejectCommitOnce(apiError(409, code)) });
      await h.runner.resume(ACCOUNT_ID);

      await h.runner.confirm();

      expect(h.runner.getSnapshot().handoff).toMatchObject({ phase: 'disclosing', notice: null });
      expect(h.api.fetchPromotionPreview).toHaveBeenCalledTimes(2);
    });

    test('guest_consumed at commit drops the handoff', async () => {
      const h = harness(captured(), { commitPromotion: jest.fn(async () => { throw consumed(); }) });
      await h.runner.resume(ACCOUNT_ID);

      await h.runner.confirm();

      expect(phase(h)).toBeNull();
      expect(h.store.current).toBeNull();
      expect(h.runner.getSnapshot().failure).toBeNull();
    });

    test('a consumed Guest at stage hands over to commit, which settles it', async () => {
      const h = harness(captured(), {
        stagePromotionPackage: jest.fn(async () => { throw consumed(); }),
        commitPromotion: jest.fn(async () => ({ status: 'committed' as const, promotionMode: 'economy' as const, replayed: true })),
      });
      await h.runner.resume(ACCOUNT_ID);

      await h.runner.confirm();

      expect(h.api.commitPromotion).toHaveBeenCalledTimes(1);
      expect(phase(h)).toBeNull();
    });
  });

  describe('app kill and resume', () => {
    const committingAtCommit = (): PromotionHandoff => ({
      ...base(),
      phase: 'committing',
      preview: preview(),
      step: { kind: 'commit' },
    });

    test('commits once more from the persisted step and accepts a replayed answer', async () => {
      const h = harness(committingAtCommit(), {
        commitPromotion: jest.fn(async () => ({ status: 'committed' as const, promotionMode: 'economy' as const, replayed: true })),
      });

      await h.runner.resume(ACCOUNT_ID);

      expect(h.api.commitPromotion).toHaveBeenCalledTimes(1);
      expect(h.api.lockPromotion).not.toHaveBeenCalled();
      expect(h.api.fetchPromotionPreview).not.toHaveBeenCalled();
      expect(h.api.drainSession).toHaveBeenCalledTimes(1);
      expect(phase(h)).toBeNull();
    });

    test('resumes a stage step with its stored lock token instead of locking again', async () => {
      const staging = harness({ ...base(), phase: 'committing', preview: preview(), step: { kind: 'stage', lockToken: 'kept' } });

      await staging.runner.resume(ACCOUNT_ID);

      expect(staging.api.lockPromotion).not.toHaveBeenCalled();
      expect(staging.api.stagePromotionPackage).toHaveBeenCalledWith(expect.objectContaining({ lockToken: 'kept' }));
    });

    test('a committed handoff resumes straight into syncing without another commit', async () => {
      const h = harness({
        ...base(),
        phase: 'syncing',
        promotionMode: 'economy',
        acked: { likes: [PATTERN_B], sessions: [] },
      });

      await h.runner.resume(ACCOUNT_ID);

      expect(h.api.commitPromotion).not.toHaveBeenCalled();
      expect(h.api.drainLike).not.toHaveBeenCalled();
      expect(h.api.drainSession).toHaveBeenCalledTimes(1);
      expect(phase(h)).toBeNull();
    });

    test('a pre-commit handoff for a different account is discarded', async () => {
      const h = harness(captured({ accountId: 'someone-else' }));

      await h.runner.resume(ACCOUNT_ID);

      expect(h.store.current).toBeNull();
      expect(h.api.fetchPromotionPreview).not.toHaveBeenCalled();
    });

    test('a post-commit handoff for a different account is left for its own account', async () => {
      const stored: PromotionHandoff = {
        ...base({ accountId: 'someone-else' }),
        phase: 'syncing',
        promotionMode: 'economy',
        acked: { likes: [], sessions: [] },
      };
      const h = harness(stored);

      await h.runner.resume(ACCOUNT_ID);

      expect(h.store.current).toBe(stored);
      expect(h.api.drainLike).not.toHaveBeenCalled();
    });

    test('with no stored handoff nothing happens', async () => {
      const h = harness(null);

      await h.runner.resume(ACCOUNT_ID);

      expect(phase(h)).toBeNull();
      expect(h.api.fetchPromotionPreview).not.toHaveBeenCalled();
    });
  });

  describe('failures', () => {
    test('a network failure at preview shows a network error, and retry continues from the same phase', async () => {
      const h = harness(captured(), {
        fetchPromotionPreview: jest
          .fn()
          .mockRejectedValueOnce(new Error('Network request failed'))
          .mockResolvedValue(preview()),
      });

      await h.runner.resume(ACCOUNT_ID);
      expect(h.runner.getSnapshot().failure).toEqual({ key: 'network', cause: null });
      expect(phase(h)).toBe('previewing');

      await h.runner.retry();

      expect(h.runner.getSnapshot().failure).toBeNull();
      expect(phase(h)).toBe('disclosing');
    });

    test.each([
      [401, 'credentialRejected'],
      [404, 'guestNotFound'],
      [403, 'accountClosing'],
    ])('status %i without a code is reported as %s', async (status, key) => {
      const h = harness(captured(), { fetchPromotionPreview: jest.fn(async () => { throw apiError(status, null); }) });

      await h.runner.resume(ACCOUNT_ID);

      expect(h.runner.getSnapshot().failure?.key).toBe(key);
    });

    test('an unknown backend code keeps its error for the Support Reference', async () => {
      const error = apiError(500, 'mystery');
      const h = harness(captured(), { fetchPromotionPreview: jest.fn(async () => { throw error; }) });

      await h.runner.resume(ACCOUNT_ID);

      expect(h.runner.getSnapshot().failure).toEqual({ key: 'unexpected', cause: error });
    });

    test('a preview issued for a different manifest is rejected', async () => {
      const h = harness(captured(), { fetchPromotionPreview: jest.fn(async () => preview({ manifestChecksum: 'other' })) });

      await h.runner.resume(ACCOUNT_ID);

      expect(phase(h)).toBe('previewing');
      expect(h.runner.getSnapshot().failure).toMatchObject({ key: 'unexpected' });
    });

    test('a missing Guest credential cannot request a preview', async () => {
      const store = memoryStore(captured());
      const fetchPromotionPreview = jest.fn();
      const runner = createPromotionRunner({
        store,
        api: { ...harness(null).api, fetchPromotionPreview },
        readCredentialSecret: async () => null,
        markLikeInAccountNamespace: async () => undefined,
        returnToGuest: async () => undefined,
        onEconomyChanged: () => undefined,
        wait: async () => undefined,
        syncBackoffMs: [],
      });

      await runner.resume(ACCOUNT_ID);

      expect(fetchPromotionPreview).not.toHaveBeenCalled();
      expect(runner.getSnapshot().failure?.key).toBe('credentialRejected');
    });
  });

  describe('sync retries', () => {
    const syncing = (): PromotionHandoff => ({
      ...base(),
      phase: 'syncing',
      promotionMode: 'economy',
      acked: { likes: [], sessions: [] },
    });

    test('retries a failing item with backoff and acknowledges each item as it succeeds', async () => {
      const h = harness(syncing(), {
        drainSession: jest
          .fn()
          .mockRejectedValueOnce(apiError(503, null))
          .mockRejectedValueOnce(apiError(503, null))
          .mockResolvedValue(undefined),
      });

      await h.runner.resume(ACCOUNT_ID);

      expect(h.wait.mock.calls).toEqual([[10], [20]]);
      expect(h.api.drainLike).toHaveBeenCalledTimes(1);
      expect(h.api.drainSession).toHaveBeenCalledTimes(3);
      expect(phase(h)).toBeNull();
      expect(h.store.writes.filter((w) => w === 'syncing')).toHaveLength(1);
    });

    test('exhausted retries enter needsAttention and keep the persisted acknowledgements', async () => {
      const h = harness(syncing(), { drainSession: jest.fn(async () => { throw apiError(503, null); }) });

      await h.runner.resume(ACCOUNT_ID);

      expect(h.api.drainSession).toHaveBeenCalledTimes(3);
      expect(h.store.current).toMatchObject({
        phase: 'needsAttention',
        acked: { likes: [PATTERN_B], sessions: [] },
      });
    });

    test('a manual retry from needsAttention drains the rest and completes', async () => {
      const h = harness(
        { ...base(), phase: 'needsAttention', promotionMode: 'economy', acked: { likes: [PATTERN_B], sessions: [] } },
      );

      await h.runner.resume(ACCOUNT_ID);
      expect(h.api.drainSession).not.toHaveBeenCalled();

      await h.runner.retry();

      expect(h.api.drainSession).toHaveBeenCalledTimes(1);
      expect(phase(h)).toBeNull();
      expect(h.onEconomyChanged).toHaveBeenCalled();
    });
  });
});
