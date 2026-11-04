import type { PromotionMode } from '../api/promotionContract';
import type { PromotionHandoff } from './handoff';

export type DisclosureLineKey =
  | 'coins'
  | 'unlocks'
  | 'pendingRewards'
  | 'adRewards'
  | 'adRewardsDiscarded'
  | 'rejectedRewards';

export interface DisclosureLine {
  key: DisclosureLineKey;
  amount: number;
}

export interface Disclosure {
  mode: PromotionMode;
  /** Economic value that arrives on the account. Always empty for data-only. */
  receives: DisclosureLine[];
  /** Economic value that is given up. Always empty for economy. */
  discards: DisclosureLine[];
  /** True when sessions, completion history or Likes move too. */
  movesProgress: boolean;
}

type Disclosing = Extract<PromotionHandoff, { phase: 'disclosing' }>;

function nonZero(lines: DisclosureLine[]): DisclosureLine[] {
  return lines.filter((line) => line.amount > 0);
}

/**
 * What the disclosure screen must list, derived only from the confirmed
 * preview and the manifest, so what the player reads is what the commit does
 * (ADR-0027): economy lists what is added, data-only lists what is discarded.
 */
export function describeDisclosure(handoff: Disclosing): Disclosure {
  const { preview, manifest } = handoff;
  const movesProgress =
    Object.keys(manifest.progress).length > 0 ||
    Object.keys(manifest.completions).length > 0 ||
    Object.keys(manifest.likes).length > 0;

  if (preview.promotionMode === 'economy') {
    return {
      mode: 'economy',
      receives: nonZero([
        { key: 'coins', amount: preview.guestLedgerBalance },
        { key: 'unlocks', amount: preview.guestUnlockCount },
        { key: 'pendingRewards', amount: preview.validatedPendingRewards.length },
        { key: 'adRewards', amount: preview.pendingAdAttemptCount },
        { key: 'rejectedRewards', amount: Object.keys(preview.rejectedPendingRewards).length },
      ]),
      discards: [],
      movesProgress,
    };
  }

  return {
    mode: 'data-only',
    receives: [],
    discards: nonZero([
      { key: 'coins', amount: preview.guestLedgerBalance },
      { key: 'unlocks', amount: preview.guestUnlockCount },
      {
        key: 'pendingRewards',
        amount: Math.max(preview.validatedPendingRewards.length, Object.keys(manifest.pendingRewards).length),
      },
      { key: 'adRewardsDiscarded', amount: preview.pendingAdAttemptCount },
    ]),
    movesProgress,
  };
}
