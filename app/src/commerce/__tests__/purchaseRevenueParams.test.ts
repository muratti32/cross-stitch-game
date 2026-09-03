import { purchaseRevenueParams } from '../catalog';
import type { CommerceProduct } from '../catalog';

/**
 * GA4 de-duplicates purchases on `transaction_id` and builds its revenue and
 * item reports from `items`, so these assert the shape the mirror hands over -
 * including that a purchase with no usable transaction id is not reported at
 * all rather than reported in a way GA4 would double count.
 */
function product(overrides: {
  currencyCode?: string;
  price?: number;
} = {}): Pick<CommerceProduct, 'package' | 'productKey' | 'productKind'> {
  return {
    package: {
      product: {
        currencyCode: overrides.currencyCode ?? 'USD',
        price: overrides.price ?? 4.99,
      },
    },
    productKey: 'coin_pack_900',
    productKind: 'stitch_coin_pack',
  } as unknown as Pick<CommerceProduct, 'package' | 'productKey' | 'productKind'>;
}

describe('purchaseRevenueParams', () => {
  it('carries the transaction id, amount, and a single item row keyed by the product', () => {
    expect(purchaseRevenueParams(product(), 'store-txn-42')).toEqual({
      currency: 'USD',
      items: [
        {
          item_category: 'stitch_coin_pack',
          item_id: 'coin_pack_900',
          price: 4.99,
          quantity: 1,
        },
      ],
      transactionId: 'store-txn-42',
      value: 4.99,
    });
  });

  it('reports the same transaction id when a reconciliation replays the same purchase', () => {
    const first = purchaseRevenueParams(product(), 'store-txn-42');
    const replay = purchaseRevenueParams(product(), 'store-txn-42');

    expect(replay?.transactionId).toBe(first?.transactionId);
  });

  it('reports nothing without a transaction id, which GA4 would otherwise double count', () => {
    expect(purchaseRevenueParams(product(), '')).toBeUndefined();
    expect(purchaseRevenueParams(product(), null)).toBeUndefined();
    expect(purchaseRevenueParams(product(), undefined)).toBeUndefined();
  });

  it('still reports the item row when the store gave no price', () => {
    const params = purchaseRevenueParams(
      product({ currencyCode: '', price: undefined }),
      'store-txn-43',
    );

    expect(params).toEqual({
      items: [{ item_category: 'stitch_coin_pack', item_id: 'coin_pack_900', quantity: 1 }],
      transactionId: 'store-txn-43',
    });
  });

  it('reports nothing for a product the store never returned', () => {
    expect(purchaseRevenueParams(undefined, 'store-txn-44')).toBeUndefined();
  });
});
