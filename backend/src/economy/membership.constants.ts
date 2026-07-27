import { DAILY_POOL_COIN } from './economy.constants';

export type PremiumPlan = 'weekly' | 'monthly' | 'annual';

export interface PremiumProduct {
  plan: PremiumPlan;
  creditsPerPaidPeriod: number;
}

// Keys are the store product identifiers exactly as registered in App Store
// Connect and Google Play (ADR-0043); RevenueCat forwards them verbatim as
// `product_id`, so any divergence silently drops the grant.
export const PREMIUM_PRODUCT_CATALOG: Readonly<Record<string, PremiumProduct>> = {
  'com.avk.stitchwish.premium_weekly': { plan: 'weekly', creditsPerPaidPeriod: 3 },
  'com.avk.stitchwish.premium_monthly': { plan: 'monthly', creditsPerPaidPeriod: 15 },
  'com.avk.stitchwish.premium_annual': { plan: 'annual', creditsPerPaidPeriod: 180 },
};

export function resolvePremiumProduct(productId: string): PremiumProduct | null {
  return PREMIUM_PRODUCT_CATALOG[productId] ?? null;
}

export function premiumDailyClaimAmount(
  coinsConsumed: number,
  alreadyClaimed: boolean,
): number {
  if (alreadyClaimed) return 0;
  return Math.max(0, DAILY_POOL_COIN - coinsConsumed);
}
