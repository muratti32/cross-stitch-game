export type CommerceCurrency = 'coin' | 'ai_credit';

export interface CommerceProduct {
  currency: CommerceCurrency;
  amount: number; // coin or AI credit granted by one unit of this product
}

// ADR-0011 fixed pack contents. Raising amounts or adding packs requires an
// explicit decision update, not a silent change here.
export const COMMERCE_PRODUCT_CATALOG: Readonly<Record<string, CommerceProduct>> = {
  coin_pack_300: { currency: 'coin', amount: 300 },
  coin_pack_900: { currency: 'coin', amount: 900 },
  coin_pack_2000: { currency: 'coin', amount: 2000 },
  ai_credit_pack_5: { currency: 'ai_credit', amount: 5 },
  ai_credit_pack_20: { currency: 'ai_credit', amount: 20 },
  ai_credit_pack_50: { currency: 'ai_credit', amount: 50 },
};

export function resolveCommerceProduct(productId: string): CommerceProduct | null {
  return COMMERCE_PRODUCT_CATALOG[productId] ?? null;
}
