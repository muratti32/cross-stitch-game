import { storeProductKey } from './store-product-id';

export type CommerceCurrency = 'coin' | 'ai_credit';

export interface CommerceProduct {
  currency: CommerceCurrency;
  amount: number; // coin or AI credit granted by one unit of this product
}

// ADR-0011 fixed pack contents. Raising amounts or adding packs requires an
// explicit decision update, not a silent change here.
//
// Keys are the store product identifiers exactly as registered in App Store
// Connect and Google Play (ADR-0043); RevenueCat forwards them verbatim as
// `product_id`, so any divergence silently drops the grant.
export const COMMERCE_PRODUCT_CATALOG = {
  'com.avk.stitchwish.coin_pack_300': { currency: 'coin', amount: 300 },
  'com.avk.stitchwish.coin_pack_900': { currency: 'coin', amount: 900 },
  'com.avk.stitchwish.coin_pack_2000': { currency: 'coin', amount: 2000 },
  'com.avk.stitchwish.ai_credit_pack_5': { currency: 'ai_credit', amount: 5 },
  'com.avk.stitchwish.ai_credit_pack_20': { currency: 'ai_credit', amount: 20 },
  'com.avk.stitchwish.ai_credit_pack_50': { currency: 'ai_credit', amount: 50 },
} as const satisfies Readonly<Record<string, CommerceProduct>>;

export function resolveCommerceProduct(productId: string): CommerceProduct | null {
  const key = storeProductKey(productId);
  return key in COMMERCE_PRODUCT_CATALOG
    ? COMMERCE_PRODUCT_CATALOG[key as keyof typeof COMMERCE_PRODUCT_CATALOG]
    : null;
}
