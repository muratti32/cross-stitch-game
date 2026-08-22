import { DAILY_POOL_COIN } from './economy.constants';
import { storeProductKey } from './store-product-id';

export type PremiumPlan = 'weekly' | 'monthly' | 'annual';

export interface PremiumProduct {
  plan: PremiumPlan;
  creditsPerPaidPeriod: number;
}

// Keys are the store product identifiers exactly as registered in App Store
// Connect and Google Play (ADR-0043); RevenueCat forwards them verbatim as
// `product_id`, so any divergence silently drops the grant.
export const PREMIUM_PRODUCT_CATALOG = {
  'com.avk.stitchwish.premium_weekly': { plan: 'weekly', creditsPerPaidPeriod: 3 },
  'com.avk.stitchwish.premium_monthly': { plan: 'monthly', creditsPerPaidPeriod: 15 },
  'com.avk.stitchwish.premium_annual': { plan: 'annual', creditsPerPaidPeriod: 180 },
} as const satisfies Readonly<Record<string, PremiumProduct>>;

export function resolvePremiumProduct(productId: string): PremiumProduct | null {
  const key = storeProductKey(productId);
  return key in PREMIUM_PRODUCT_CATALOG
    ? PREMIUM_PRODUCT_CATALOG[key as keyof typeof PREMIUM_PRODUCT_CATALOG]
    : null;
}

export function premiumDailyClaimAmount(
  coinsConsumed: number,
  alreadyClaimed: boolean,
): number {
  if (alreadyClaimed) return 0;
  return Math.max(0, DAILY_POOL_COIN - coinsConsumed);
}
