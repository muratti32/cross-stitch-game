import { captureGameplayEvent } from './gameplayEvents';
import type { PatternUnlockTier } from './schema';

/** Emits `pattern_chart_purchased` only after a real charge, never on an already-entitled replay. */
export function recordChartPurchaseResult(result: { alreadyEntitled: boolean; price: number; tier: PatternUnlockTier }): void {
  if (!result.alreadyEntitled) {
    void captureGameplayEvent('pattern_chart_purchased', { tier: result.tier, price: result.price });
  }
}
