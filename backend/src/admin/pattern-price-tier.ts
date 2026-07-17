import type { PatternUnlockPriceTier } from '../catalog/entities';

const SMALL_MAX_STITCHABLE_CELLS = 3_999;
const MEDIUM_MAX_STITCHABLE_CELLS = 14_999;

/**
 * The Pattern Unlock Price Tier of a paid Official Pattern is always derived
 * from its stitchable-cell count (ADR-0039); the console only offers a
 * free-or-paid choice, never a direct tier selection.
 */
export function deriveUnlockPriceTier(
  paid: boolean,
  stitchableCellCount: number,
): PatternUnlockPriceTier {
  if (!paid) {
    return null;
  }
  if (
    !Number.isSafeInteger(stitchableCellCount) ||
    stitchableCellCount < 1
  ) {
    throw new RangeError(
      'Stitchable cell count must be a positive integer to derive a paid Pattern Unlock Price Tier',
    );
  }
  if (stitchableCellCount <= SMALL_MAX_STITCHABLE_CELLS) {
    return 'small';
  }
  if (stitchableCellCount <= MEDIUM_MAX_STITCHABLE_CELLS) {
    return 'medium';
  }
  return 'large';
}
