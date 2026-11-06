import {
  canCancel,
  eventForFailureCode,
  isSyncHandoff,
  isPreviewEmpty,
  pendingLikes,
  pendingSessions,
  reducePromotion,
  type PromotionEvent,
  type PromotionHandoff,
} from '../handoff';
import {
  captured,
  emptyManifest,
  emptyPreview,
  PATTERN_A,
  PATTERN_B,
  preview,
  SESSION_A,
  packaged,
} from './fixtures';

function run(start: PromotionHandoff | null, events: PromotionEvent[]): PromotionHandoff | null {
  return events.reduce<PromotionHandoff | null>((state, event) => (state === null ? null : reducePromotion(state, event)), start);
}

const toDisclosing = (mode: 'economy' | 'data-only' = 'economy'): PromotionEvent[] => [
  { type: 'previewStarted' },
  { type: 'previewLoaded', preview: preview({ promotionMode: mode }) },
];

describe('Promotion Handoff transitions', () => {
  test('walks captured to previewing to disclosing to committing to syncing to done', () => {
    const disclosing = run(captured(), toDisclosing());
    expect(disclosing).toMatchObject({ phase: 'disclosing', notice: null });

    const committing = reducePromotion(disclosing as PromotionHandoff, { type: 'confirmed' });
    expect(committing).toMatchObject({ phase: 'committing', step: { kind: 'lock' } });

    const committed = run(committing, [
      { type: 'locked', lockToken: 'lock-1' },
      { type: 'staged' },
      { type: 'committed', promotionMode: 'economy' },
    ]);
    expect(committed).toMatchObject({
      phase: 'syncing',
      promotionMode: 'economy',
      acked: { likes: [], sessions: [] },
    });
    expect(committed).not.toHaveProperty('preview');
    expect(committed).not.toHaveProperty('step');

    const afterLike = reducePromotion(committed as PromotionHandoff, { type: 'likeAcked', patternId: PATTERN_B });
    expect(afterLike).toMatchObject({ phase: 'syncing', acked: { likes: [PATTERN_B] } });
    expect(reducePromotion(afterLike as PromotionHandoff, { type: 'sessionAcked', guestSessionId: SESSION_A })).toBeNull();
  });

  test('records the lock token and refuses to skip a step', () => {
    const committing = run(captured(), [...toDisclosing(), { type: 'confirmed' }]) as PromotionHandoff;

    expect(reducePromotion(committing, { type: 'staged' })).toMatchObject({ step: { kind: 'commit' } });
    expect(reducePromotion(committing, { type: 'locked', lockToken: 'L' })).toMatchObject({
      step: { kind: 'stage', lockToken: 'L' },
    });
    const staging = reducePromotion(committing, { type: 'locked', lockToken: 'L' }) as PromotionHandoff;
    expect(reducePromotion(staging, { type: 'locked', lockToken: 'OTHER' })).toEqual(staging);
  });

  test('skips the screen entirely when the preview is empty', () => {
    const next = run(
      captured({ manifest: emptyManifest(), drain: { likes: [], sessions: [] } }),
      [{ type: 'previewStarted' }, { type: 'previewLoaded', preview: emptyPreview() }],
    );

    expect(next).toBeNull();
  });

  test('an empty server side with local records still discloses', () => {
    const next = run(captured(), [{ type: 'previewStarted' }, { type: 'previewLoaded', preview: emptyPreview() }]);

    expect(next).toMatchObject({ phase: 'disclosing' });
  });

  test.each([
    ['Coin', { guestLedgerBalance: 1 }],
    ['Pattern Unlocks', { guestUnlockCount: 1 }],
    ['a validated pending reward', { validatedPendingRewards: ['first_completion:guest:g:p'] }],
    ['a pending ad attempt', { pendingAdAttemptCount: 1 }],
  ])('%s alone is enough to disclose', (_label, override) => {
    expect(isPreviewEmpty({ ...emptyPreview(), ...override }, emptyManifest())).toBe(false);
  });

  test('a data-only preview keeps its mode through to the committed handoff', () => {
    const committed = run(captured(), [
      ...toDisclosing('data-only'),
      { type: 'confirmed' },
      { type: 'locked', lockToken: 'L' },
      { type: 'staged' },
      { type: 'committed', promotionMode: 'data-only' },
    ]);

    expect(committed).toMatchObject({ phase: 'syncing', promotionMode: 'data-only' });
  });

  test('commit with nothing left to drain finishes the handoff', () => {
    const noLocalItems = captured({ drain: { likes: [], sessions: [] } });
    const done = run(noLocalItems, [
      ...toDisclosing(),
      { type: 'confirmed' },
      { type: 'staged' },
      { type: 'committed', promotionMode: 'economy' },
    ]);

    expect(done).toBeNull();
  });

  describe('cancel', () => {
    test.each(['captured', 'previewing', 'disclosing'] as const)('is allowed in %s', (phase) => {
      const events: Record<string, PromotionEvent[]> = {
        captured: [],
        previewing: [{ type: 'previewStarted' }],
        disclosing: toDisclosing(),
      };
      const state = run(captured(), events[phase]) as PromotionHandoff;

      expect(canCancel(state)).toBe(true);
      expect(reducePromotion(state, { type: 'cancelled' })).toBeNull();
    });

    test('is allowed while locking and staging but not once the commit step is reached', () => {
      const locking = run(captured(), [...toDisclosing(), { type: 'confirmed' }]) as PromotionHandoff;
      const staging = reducePromotion(locking, { type: 'locked', lockToken: 'L' }) as PromotionHandoff;
      const committing = reducePromotion(staging, { type: 'staged' }) as PromotionHandoff;

      expect(canCancel(locking)).toBe(true);
      expect(canCancel(staging)).toBe(true);
      expect(canCancel(committing)).toBe(false);
      expect(reducePromotion(committing, { type: 'cancelled' })).toEqual(committing);
    });

    test('is never offered after the commit', () => {
      const syncing = run(captured(), [
        ...toDisclosing(),
        { type: 'confirmed' },
        { type: 'staged' },
        { type: 'committed', promotionMode: 'economy' },
      ]) as PromotionHandoff;

      expect(canCancel(syncing)).toBe(false);
      expect(reducePromotion(syncing, { type: 'cancelled' })).toEqual(syncing);
    });
  });

  describe('commit rejections', () => {
    const committingAtCommit = (): PromotionHandoff =>
      run(captured(), [...toDisclosing(), { type: 'confirmed' }, { type: 'staged' }]) as PromotionHandoff;

    test('promotion_stale returns to previewing with a stale notice and then discloses it again', () => {
      const event = eventForFailureCode('promotion_stale', 'commit');
      expect(event).toEqual({ type: 'previewInvalidated', notice: 'stale' });

      const previewing = reducePromotion(committingAtCommit(), event as PromotionEvent);
      expect(previewing).toMatchObject({ phase: 'previewing', notice: 'stale' });

      const disclosing = reducePromotion(previewing as PromotionHandoff, {
        type: 'previewLoaded',
        preview: preview({ promotionMode: 'data-only' }),
      });
      expect(disclosing).toMatchObject({ phase: 'disclosing', notice: 'stale' });
      expect(disclosing).toMatchObject({ preview: { promotionMode: 'data-only' } });
    });

    test.each(['promotion_lock_expired', 'preview_expired'])('%s returns to previewing without a notice', (code) => {
      const event = eventForFailureCode(code, 'commit') as PromotionEvent;

      expect(reducePromotion(committingAtCommit(), event)).toMatchObject({ phase: 'previewing', notice: null });
    });

    test('guest_consumed at commit drops the handoff', () => {
      const event = eventForFailureCode('guest_consumed', 'commit') as PromotionEvent;

      expect(reducePromotion(committingAtCommit(), event)).toBeNull();
    });

    test('guest_consumed at preview drops the handoff', () => {
      const event = eventForFailureCode('guest_consumed', 'preview') as PromotionEvent;

      expect(run(captured(), [{ type: 'previewStarted' }, event])).toBeNull();
    });

    test('guest_consumed at lock or stage hands over to commit instead of dropping', () => {
      expect(eventForFailureCode('guest_consumed', 'lock')).toEqual({ type: 'staged' });
      expect(eventForFailureCode('guest_consumed', 'stage')).toEqual({ type: 'staged' });
    });

    test('unknown codes and preview-time expiry codes have no domain transition', () => {
      expect(eventForFailureCode('mystery', 'commit')).toBeNull();
      expect(eventForFailureCode(null, 'lock')).toBeNull();
      expect(eventForFailureCode('promotion_stale', 'preview')).toBeNull();
    });
  });

  test('every transition keeps the packaged sessions', () => {
    const sessions = [packaged({ packedBitmapBase64: 'AQ==' })];
    const previewing = reducePromotion(captured({ sessions }), { type: 'previewStarted' });
    const disclosing = reducePromotion(previewing as PromotionHandoff, { type: 'previewLoaded', preview: preview() });
    const committing = reducePromotion(disclosing as PromotionHandoff, { type: 'confirmed' });
    const syncing = reducePromotion(committing as PromotionHandoff, { type: 'committed', promotionMode: 'economy' });

    expect(syncing).toMatchObject({ phase: 'syncing', sessions });
  });

  describe('sync', () => {
    const syncing = (): PromotionHandoff =>
      run(captured(), [
        ...toDisclosing(),
        { type: 'confirmed' },
        { type: 'staged' },
        { type: 'committed', promotionMode: 'economy' },
      ]) as PromotionHandoff;

    test('acknowledgements are idempotent and tracked per item', () => {
      const once = reducePromotion(syncing(), { type: 'likeAcked', patternId: PATTERN_B }) as PromotionHandoff;
      const twice = reducePromotion(once, { type: 'likeAcked', patternId: PATTERN_B }) as PromotionHandoff;

      expect(twice).toEqual(once);
      expect(pendingLikes(once as never)).toEqual([]);
      expect(pendingSessions(once as never)).toEqual([{ guestSessionId: SESSION_A, patternId: PATTERN_A, serverKnown: true }]);
    });

    test('exhausted retries enter needsAttention and keep what was acknowledged', () => {
      const partial = reducePromotion(syncing(), { type: 'likeAcked', patternId: PATTERN_B }) as PromotionHandoff;
      const attention = reducePromotion(partial, { type: 'syncExhausted' }) as PromotionHandoff;

      expect(attention).toMatchObject({ phase: 'needsAttention', acked: { likes: [PATTERN_B], sessions: [] } });
      expect(isSyncHandoff(attention)).toBe(true);

      const retried = reducePromotion(attention, { type: 'syncRetried' });
      expect(retried).toMatchObject({ phase: 'syncing', acked: { likes: [PATTERN_B], sessions: [] } });
    });

    test('the last acknowledgement from needsAttention also finishes the handoff', () => {
      const attention = reducePromotion(
        reducePromotion(syncing(), { type: 'likeAcked', patternId: PATTERN_B }) as PromotionHandoff,
        { type: 'syncExhausted' },
      ) as PromotionHandoff;

      expect(reducePromotion(attention, { type: 'sessionAcked', guestSessionId: SESSION_A })).toBeNull();
    });
  });

  test('events that do not apply to the phase leave the handoff untouched', () => {
    const start = captured();

    expect(reducePromotion(start, { type: 'confirmed' })).toEqual(start);
    expect(reducePromotion(start, { type: 'committed', promotionMode: 'economy' })).toEqual(start);
    expect(reducePromotion(start, { type: 'syncExhausted' })).toEqual(start);
  });
});
