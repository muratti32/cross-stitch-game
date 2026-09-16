// Stitch Coin economy constants fixed by ADR-0011. Raising prices or lowering
// these guaranteed values beyond the ADR's bounds requires an explicit decision
// update, not a silent change here.

/** Coin granted for a single verified Rewarded Ad completion. */
export const AD_REWARD_COIN = 10;

/**
 * Total coin in a Reward Day's Ad-Equivalent Coin Pool, shared by Rewarded Ads
 * and the (later) Premium Daily Coin Claim. No ordering can exceed this.
 */
export const DAILY_POOL_COIN = 30;

/** Maximum verified Rewarded Ads that may be rewarded in one Reward Day. */
export const DAILY_AD_LIMIT = 3;

/**
 * First Completion Reward tiers by total stitchable cells (width × height),
 * fixed by ADR-0011. DMC thread color count is never a multiplier. Granted
 * exactly once per eligible catalog Pattern; Personal Patterns and Replay
 * Sessions never mint it.
 */
export const FIRST_COMPLETION_TIER_COIN = {
  /** Small: 1–3,999 cells. */
  small: 25,
  /** Medium: 4,000–14,999 cells. */
  medium: 60,
  /** Large: 15,000+ cells. */
  large: 120,
} as const;

/** Cell-count boundaries between First Completion Reward tiers (ADR-0011). */
export const FIRST_COMPLETION_MEDIUM_MIN_CELLS = 4_000;
export const FIRST_COMPLETION_LARGE_MIN_CELLS = 15_000;

/**
 * Resolve the First Completion Reward for a finished Pattern from its total
 * stitchable cell count. A completed Pattern always has ≥ 1 cell.
 */
export function firstCompletionReward(cells: number): number {
  if (cells >= FIRST_COMPLETION_LARGE_MIN_CELLS) {
    return FIRST_COMPLETION_TIER_COIN.large;
  }
  if (cells >= FIRST_COMPLETION_MEDIUM_MIN_CELLS) {
    return FIRST_COMPLETION_TIER_COIN.medium;
  }
  return FIRST_COMPLETION_TIER_COIN.small;
}

// Stitch Coin pattern unlock price tier mapping fixed by ADR-0011.
export const UNLOCK_PRICE_TIER_COIN = { small: 75, medium: 150, large: 300 } as const;
export type UnlockPriceTier = keyof typeof UNLOCK_PRICE_TIER_COIN; // 'small'|'medium'|'large'
export function unlockPrice(tier: UnlockPriceTier): number { return UNLOCK_PRICE_TIER_COIN[tier]; }

/** Coin auto-granted for completing one Daily Task (ADR-0011). */
export const DAILY_TASK_COIN = 10;
/** Task cells_100: total successful Stitch Actions required in a Reward Day. */
export const DAILY_TASK_CELLS_TARGET = 100;
/** Task three_colors_10: Stitch Actions needed in a single DMC color to count it. */
export const DAILY_TASK_COLOR_ACTIONS_MIN = 10;
/** Task three_colors_10: distinct qualifying DMC colors required. */
export const DAILY_TASK_DISTINCT_COLORS_TARGET = 3;

/**
 * Physical plausibility floor for a whole Stitching Session, applied as an
 * aggregate by the Completion Claim validator (ADR-0062). It is deliberately
 * not a per-event Daily Task velocity limit: a Stitch Sweep fills many cells
 * inside one gesture, so Daily Task evidence is bounded by ownership and
 * deduplication instead (ADR-0063).
 */
export const MIN_MS_PER_STITCH = 50;

export type DailyTaskKey = 'cells_100' | 'three_colors_10' | 'color_completion';
export const DAILY_TASK_KEYS: readonly DailyTaskKey[] = [
  'cells_100',
  'three_colors_10',
  'color_completion',
];

export const AD_PLACEMENT_REWARDED = 'rewarded_ad';

