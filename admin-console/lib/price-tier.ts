import type { PatternUnlockPriceTier } from './types';

// Mirrors backend/src/admin/pattern-price-tier.ts. The backend is the only
// place that actually derives and persists the tier at publish time; this is
// a client-side hint shown to the operator before they publish (ADR-0039: the
// console only offers a free/paid choice, never a direct tier selection).
const SMALL_MAX_STITCHABLE_CELLS = 3_999;
const MEDIUM_MAX_STITCHABLE_CELLS = 14_999;

export const PRICE_TIER_UNIT_LABELS: Record<Exclude<PatternUnlockPriceTier, null>, string> = {
  large: 'Large (300)',
  medium: 'Medium (150)',
  small: 'Small (75)',
};

export function deriveUnlockPriceTierHint(
  paid: boolean,
  stitchableCellCount: number | null,
): PatternUnlockPriceTier {
  if (!paid || stitchableCellCount === null || stitchableCellCount < 1) {
    return null;
  }
  if (stitchableCellCount <= SMALL_MAX_STITCHABLE_CELLS) {
    return 'small';
  }
  if (stitchableCellCount <= MEDIUM_MAX_STITCHABLE_CELLS) {
    return 'medium';
  }
  return 'large';
}
