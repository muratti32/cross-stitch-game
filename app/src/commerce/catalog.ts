import type {
  PurchasesIntroPrice,
  PurchasesOfferings,
  PurchasesPackage,
} from 'react-native-purchases';

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
}

export interface CommerceProduct extends ProductDefinition {
  readonly billingPeriod: string | null;
  /** Period noun this product's grants are measured against, e.g. `year`. */
  readonly creditPeriod: string | null;
  /**
   * How long the store's introductory offer for this product runs free of
   * charge, e.g. `3 days`, or null when the store advertises no free offer. The
   * store owns this offer; the app never assumes a duration of its own.
   */
  readonly freeIntroductoryOffer: string | null;
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
  },
  {
    category: 'premium',
    credits: 15,
    label: 'Monthly',
    productKey: 'premium_monthly',
    productKind: 'premium_membership',
    quantity: 15,
    storeProductId: 'com.avk.stitchwish.premium_monthly',
  },
  {
    category: 'premium',
    credits: 3,
    label: 'Weekly',
    productKey: 'premium_weekly',
    productKind: 'premium_membership',
    quantity: 3,
    storeProductId: 'com.avk.stitchwish.premium_weekly',
  },
  {
    category: 'stitch_coin',
    label: '300 Stitch Coins',
    productKey: 'coin_pack_300',
    productKind: 'stitch_coin_pack',
    quantity: 300,
    storeProductId: 'com.avk.stitchwish.coin_pack_300',
  },
  {
    category: 'stitch_coin',
    label: '900 Stitch Coins',
    productKey: 'coin_pack_900',
    productKind: 'stitch_coin_pack',
    quantity: 900,
    storeProductId: 'com.avk.stitchwish.coin_pack_900',
  },
  {
    category: 'stitch_coin',
    label: '2,000 Stitch Coins',
    productKey: 'coin_pack_2000',
    productKind: 'stitch_coin_pack',
    quantity: 2000,
    storeProductId: 'com.avk.stitchwish.coin_pack_2000',
  },
  {
    category: 'ai_credit',
    label: '5 AI Credits',
    productKey: 'ai_credit_pack_5',
    productKind: 'ai_credit_pack',
    quantity: 5,
    storeProductId: 'com.avk.stitchwish.ai_credit_pack_5',
  },
  {
    category: 'ai_credit',
    label: '20 AI Credits',
    productKey: 'ai_credit_pack_20',
    productKind: 'ai_credit_pack',
    quantity: 20,
    storeProductId: 'com.avk.stitchwish.ai_credit_pack_20',
  },
  {
    category: 'ai_credit',
    label: '50 AI Credits',
    productKey: 'ai_credit_pack_50',
    productKind: 'ai_credit_pack',
    quantity: 50,
    storeProductId: 'com.avk.stitchwish.ai_credit_pack_50',
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
      creditPeriod: subscriptionPeriodNoun(matchingPackage.product.subscriptionPeriod),
      freeIntroductoryOffer: freeIntroductoryOfferDuration(matchingPackage.product.introPrice),
      priceString: matchingPackage.product.priceString,
    }];
  });
}

type PeriodUnit = readonly [singular: string, plural: string];

const ISO_PERIOD_UNITS: Readonly<Record<string, PeriodUnit>> = {
  D: ['day', 'days'],
  W: ['week', 'weeks'],
  M: ['month', 'months'],
  Y: ['year', 'years'],
};

interface ParsedPeriod {
  readonly amount: number;
  readonly unit: PeriodUnit;
}

function parseIsoPeriod(period: string): ParsedPeriod | null {
  const match = /^P(\d+)([DWMY])$/.exec(period);
  if (match === null) return null;
  const unit = ISO_PERIOD_UNITS[match[2]];
  if (unit === undefined) return null;
  return { amount: Number(match[1]), unit };
}

function countedPeriod(parsed: ParsedPeriod): string {
  return `${parsed.amount} ${parsed.amount === 1 ? parsed.unit[0] : parsed.unit[1]}`;
}

function subscriptionPeriodLabel(period: string | null): string | null {
  if (period === null) return null;
  const parsed = parseIsoPeriod(period);
  return parsed === null ? period : countedPeriod(parsed);
}

// The noun a plan's grants are measured against: `year` for P1Y, `month` for
// P1M, and `3 months` for a hypothetical P3M, so an Annual allowance never
// reads as a monthly one.
function subscriptionPeriodNoun(period: string | null): string | null {
  if (period === null) return null;
  const parsed = parseIsoPeriod(period);
  if (parsed === null) return null;
  return parsed.amount === 1 ? parsed.unit[0] : `${parsed.amount} ${parsed.unit[1]}`;
}

// Reads how long a store-advertised introductory offer runs free of charge.
// RevenueCat reports paid introductory prices through the same `introPrice`
// field, so a non-zero offer is not a trial and yields null: the plan then keeps
// its ordinary paid offer instead of being advertised as free. An offer whose
// period cannot be parsed is likewise treated as no offer rather than advertised
// with a guessed duration.
function freeIntroductoryOfferDuration(introPrice: PurchasesIntroPrice | null): string | null {
  if (introPrice === null || introPrice.price !== 0) return null;
  const parsed = parseIsoPeriod(introPrice.period);
  return parsed === null ? null : countedPeriod(parsed);
}

/**
 * Resolves a store product identifier back to the analytics vocabulary. Used to
 * report a canonical product the current offering did not return, where no
 * CommerceProduct exists to read the keys from.
 */
export function commerceProductIdentity(
  storeProductIdentifier: string,
): Pick<ProductDefinition, 'productKey' | 'productKind'> | null {
  const definition = PRODUCT_DEFINITIONS.find(
    (candidate) => candidate.storeProductId === storeProductId(storeProductIdentifier),
  );
  return definition === undefined
    ? null
    : { productKey: definition.productKey, productKind: definition.productKind };
}

export function productsInCategory(
  products: readonly CommerceProduct[],
  category: CommerceCategory,
): CommerceProduct[] {
  return products.filter((product) => product.category === category);
}

export type PremiumPlanChangeKind = 'upgrade' | 'plan_change';

// App Store subscription-group ordering for the three Premium Plans (Annual,
// Monthly, Weekly): moving to a higher rank is an upgrade, the reverse is a
// store-controlled plan change (ADR pending #123's confirmation flow).
const PREMIUM_PLAN_RANK: Readonly<Record<'premium_weekly' | 'premium_monthly' | 'premium_annual', number>> = {
  premium_weekly: 0,
  premium_monthly: 1,
  premium_annual: 2,
};

/**
 * Classifies a target Premium Plan relative to the plan currently held. Only
 * meaningful on iOS, where the subscription group enforces one ordering;
 * Android has no equivalent direct plan-change action to classify.
 */
export function classifyPremiumPlanChange(
  currentProductKey: string,
  targetProductKey: string,
): PremiumPlanChangeKind | null {
  const currentRank = PREMIUM_PLAN_RANK[currentProductKey as keyof typeof PREMIUM_PLAN_RANK];
  const targetRank = PREMIUM_PLAN_RANK[targetProductKey as keyof typeof PREMIUM_PLAN_RANK];
  if (currentRank === undefined || targetRank === undefined || currentRank === targetRank) {
    return null;
  }
  return targetRank > currentRank ? 'upgrade' : 'plan_change';
}

// Google Play appends `:basePlanId` to subscriptions. ADR-0043 permits only
// this one normalization; Apple and consumable identifiers are unchanged.
export function storeProductId(identifier: string): string {
  const separator = identifier.indexOf(':');
  return separator === -1 ? identifier : identifier.slice(0, separator);
}
