import type { PurchasesOfferings, PurchasesPackage } from 'react-native-purchases';

import type {
  PurchaseProductKey,
  PurchaseProductKind,
} from '../analytics/schema';

export type CommerceCategory = 'premium' | 'stitch_coin' | 'ai_credit';

interface ProductDefinition {
  readonly category: CommerceCategory;
  readonly credits?: number;
  readonly label: string;
  readonly productKey: PurchaseProductKey;
  readonly productKind: PurchaseProductKind;
  readonly quantity: number;
  readonly storeProductId: string;
  readonly trial: boolean;
}

export interface CommerceProduct extends ProductDefinition {
  readonly billingPeriod: string | null;
  readonly id: string;
  readonly package: PurchasesPackage;
  readonly priceString: string;
}

const PRODUCT_DEFINITIONS: readonly ProductDefinition[] = [
  {
    category: 'premium',
    credits: 180,
    label: 'Annual',
    productKey: 'premium_annual',
    productKind: 'premium_membership',
    quantity: 180,
    storeProductId: 'com.avk.stitchwish.premium_annual',
    trial: false,
  },
  {
    category: 'premium',
    credits: 15,
    label: 'Monthly',
    productKey: 'premium_monthly',
    productKind: 'premium_membership',
    quantity: 15,
    storeProductId: 'com.avk.stitchwish.premium_monthly',
    trial: true,
  },
  {
    category: 'premium',
    credits: 3,
    label: 'Weekly',
    productKey: 'premium_weekly',
    productKind: 'premium_membership',
    quantity: 3,
    storeProductId: 'com.avk.stitchwish.premium_weekly',
    trial: false,
  },
  {
    category: 'stitch_coin',
    label: '300 Stitch Coins',
    productKey: 'coin_pack_300',
    productKind: 'stitch_coin_pack',
    quantity: 300,
    storeProductId: 'com.avk.stitchwish.coin_pack_300',
    trial: false,
  },
  {
    category: 'stitch_coin',
    label: '900 Stitch Coins',
    productKey: 'coin_pack_900',
    productKind: 'stitch_coin_pack',
    quantity: 900,
    storeProductId: 'com.avk.stitchwish.coin_pack_900',
    trial: false,
  },
  {
    category: 'stitch_coin',
    label: '2,000 Stitch Coins',
    productKey: 'coin_pack_2000',
    productKind: 'stitch_coin_pack',
    quantity: 2000,
    storeProductId: 'com.avk.stitchwish.coin_pack_2000',
    trial: false,
  },
  {
    category: 'ai_credit',
    label: '5 AI Credits',
    productKey: 'ai_credit_pack_5',
    productKind: 'ai_credit_pack',
    quantity: 5,
    storeProductId: 'com.avk.stitchwish.ai_credit_pack_5',
    trial: false,
  },
  {
    category: 'ai_credit',
    label: '20 AI Credits',
    productKey: 'ai_credit_pack_20',
    productKind: 'ai_credit_pack',
    quantity: 20,
    storeProductId: 'com.avk.stitchwish.ai_credit_pack_20',
    trial: false,
  },
  {
    category: 'ai_credit',
    label: '50 AI Credits',
    productKey: 'ai_credit_pack_50',
    productKind: 'ai_credit_pack',
    quantity: 50,
    storeProductId: 'com.avk.stitchwish.ai_credit_pack_50',
    trial: false,
  },
];

export function commerceProductsFromOfferings(
  offerings: PurchasesOfferings,
): CommerceProduct[] {
  const packages = offerings.current?.availablePackages ?? [];

  return PRODUCT_DEFINITIONS.flatMap((definition) => {
    const matchingPackage = packages.find((pkg) =>
      [pkg.identifier, pkg.product.identifier]
        .map(storeProductId)
        .includes(definition.storeProductId),
    );
    if (!matchingPackage) return [];

    return [{
      ...definition,
      id: matchingPackage.identifier,
      package: matchingPackage,
      billingPeriod: subscriptionPeriodLabel(matchingPackage.product.subscriptionPeriod),
      priceString: matchingPackage.product.priceString,
    }];
  });
}

function subscriptionPeriodLabel(period: string | null): string | null {
  if (period === null) return null;
  const match = /^P(\d+)([DWMY])$/.exec(period);
  if (match === null) return period;
  const amount = Number(match[1]);
  const units: Record<string, [string, string]> = {
    D: ['day', 'days'],
    W: ['week', 'weeks'],
    M: ['month', 'months'],
    Y: ['year', 'years'],
  };
  const unit = units[match[2]];
  return `${amount} ${amount === 1 ? unit[0] : unit[1]}`;
}

export function productsInCategory(
  products: readonly CommerceProduct[],
  category: CommerceCategory,
): CommerceProduct[] {
  return products.filter((product) => product.category === category);
}

// Google Play appends `:basePlanId` to subscriptions. ADR-0043 permits only
// this one normalization; Apple and consumable identifiers are unchanged.
export function storeProductId(identifier: string): string {
  const separator = identifier.indexOf(':');
  return separator === -1 ? identifier : identifier.slice(0, separator);
}
