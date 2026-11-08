import { captureGameplayEvent } from './gameplayEvents';
import type { PatternUnlockTier } from './schema';

// ADR-0068: chart prices are fixed per cell-count tier, 20 / 40 / 60 Stitch Coin.
const TIER_BY_CHART_PRICE: Readonly<Record<number, PatternUnlockTier>> = { 20: 'small', 40: 'medium', 60: 'large' };

export function chartTierForPrice(price: number): PatternUnlockTier | null {
  return TIER_BY_CHART_PRICE[price] ?? null;
}

/** Emits `pattern_chart_purchased` only after a real charge, never on an already-entitled replay. */
export function recordChartPurchaseResult(result: { alreadyEntitled: boolean; price: number }): void {
  const tier = chartTierForPrice(result.price);
  if (!result.alreadyEntitled && tier !== null) {
    void captureGameplayEvent('pattern_chart_purchased', { tier, price: result.price });
  }
}
