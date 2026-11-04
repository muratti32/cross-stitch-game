import { describeDisclosure } from '../disclosureModel';
import type { PromotionHandoff } from '../handoff';
import { base, emptyManifest, manifest, preview } from './fixtures';

type Disclosing = Extract<PromotionHandoff, { phase: 'disclosing' }>;

const disclosing = (previewOverrides: Parameters<typeof preview>[0], baseOverrides: Parameters<typeof base>[0] = {}): Disclosing => ({
  ...base(baseOverrides),
  phase: 'disclosing',
  preview: preview(previewOverrides),
  notice: null,
});

describe('describeDisclosure', () => {
  test('economy lists Coin, Unlocks, validated rewards and verifying ad rewards that will arrive', () => {
    const result = describeDisclosure(
      disclosing({
        guestLedgerBalance: 120,
        guestUnlockCount: 2,
        validatedPendingRewards: ['a', 'b', 'c'],
        pendingAdAttemptCount: 1,
      }),
    );

    expect(result.mode).toBe('economy');
    expect(result.receives).toEqual([
      { key: 'coins', amount: 120 },
      { key: 'unlocks', amount: 2 },
      { key: 'pendingRewards', amount: 3 },
      { key: 'adRewards', amount: 1 },
    ]);
    expect(result.discards).toEqual([]);
    expect(result.movesProgress).toBe(true);
  });

  test('economy names the rewards it could not verify', () => {
    const result = describeDisclosure(
      disclosing({ guestLedgerBalance: 0, guestUnlockCount: 0, pendingAdAttemptCount: 0, rejectedPendingRewards: { k: 'implausible_evidence' } }),
    );

    expect(result.receives).toEqual([{ key: 'rejectedRewards', amount: 1 }]);
  });

  test('data-only receives nothing and lists every economic item as discarded', () => {
    const result = describeDisclosure(
      disclosing(
        {
          promotionMode: 'data-only',
          guestLedgerBalance: 50,
          guestUnlockCount: 1,
          pendingAdAttemptCount: 2,
          validatedPendingRewards: [],
        },
        { manifest: manifest({ pendingRewards: { 'first_completion:guest:g:p': {
          localSessionId: 'l', remoteSessionId: 'r', patternId: 'p', completedAt: 't', completedCells: 1,
        } } }) },
      ),
    );

    expect(result.mode).toBe('data-only');
    expect(result.receives).toEqual([]);
    expect(result.discards).toEqual([
      { key: 'coins', amount: 50 },
      { key: 'unlocks', amount: 1 },
      { key: 'pendingRewards', amount: 1 },
      { key: 'adRewardsDiscarded', amount: 2 },
    ]);
  });

  test('omits zero amounts and reports no progress move for an empty manifest', () => {
    const result = describeDisclosure(
      disclosing({ guestLedgerBalance: 9, guestUnlockCount: 0, pendingAdAttemptCount: 0 }, { manifest: emptyManifest() }),
    );

    expect(result.receives).toEqual([{ key: 'coins', amount: 9 }]);
    expect(result.movesProgress).toBe(false);
  });
});
