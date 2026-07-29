import { resolveCommerceProduct } from './commerce.constants';
import { resolvePremiumProduct } from './membership.constants';
import { storeProductKey } from './store-product-id';

describe('store product identifiers', () => {
  it('leaves an Apple identifier untouched', () => {
    expect(storeProductKey('com.avk.stitchwish.premium_monthly')).toBe(
      'com.avk.stitchwish.premium_monthly',
    );
  });

  it('drops the Play base-plan suffix', () => {
    expect(storeProductKey('com.avk.stitchwish.premium_monthly:monthly')).toBe(
      'com.avk.stitchwish.premium_monthly',
    );
  });

  it('resolves a Premium Plan bought on either store', () => {
    expect(resolvePremiumProduct('com.avk.stitchwish.premium_annual')).toEqual({
      plan: 'annual',
      creditsPerPaidPeriod: 180,
    });
    expect(resolvePremiumProduct('com.avk.stitchwish.premium_annual:annual')).toEqual({
      plan: 'annual',
      creditsPerPaidPeriod: 180,
    });
  });

  it('resolves a consumable bought on either store', () => {
    expect(resolveCommerceProduct('com.avk.stitchwish.coin_pack_900')).toEqual({
      currency: 'coin',
      amount: 900,
    });
    expect(resolveCommerceProduct('com.avk.stitchwish.coin_pack_900:base')).toEqual({
      currency: 'coin',
      amount: 900,
    });
  });

  it('still rejects an unknown product', () => {
    expect(resolvePremiumProduct('com.avk.stitchwish.premium_lifetime')).toBeNull();
    expect(resolveCommerceProduct('coin_pack_900')).toBeNull();
  });
});
