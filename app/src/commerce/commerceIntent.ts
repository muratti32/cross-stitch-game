import { create } from 'zustand';

import type {
  CommerceEntrySource,
  PurchaseProductKey,
  PurchaseProductKind,
} from '../analytics/schema';
import type { CommerceCategory } from './catalog';

export interface CommercePurchaseIntent {
  readonly category: CommerceCategory;
  readonly entrySource: CommerceEntrySource;
  readonly productKey: PurchaseProductKey | null;
  readonly productKind: PurchaseProductKind | null;
}

/**
 * The Stitching Session a Locator Coin Shortfall was raised in, carried only
 * across the Android Guest authentication detour (#268). `returnTo` is the
 * originating screen's own back target, so returning restores the header
 * affordance the session was opened with instead of resetting it to the table.
 */
export interface LocatorShortfallOrigin {
  readonly sessionId: string;
  readonly returnTo: string | null;
}

interface CommerceIntentState {
  intent: CommercePurchaseIntent | null;
  locatorShortfallOrigin: LocatorShortfallOrigin | null;
  clearCategoryIntent: () => void;
  clearIntent: () => void;
  clearLocatorShortfallOrigin: () => void;
  preserveCategoryIntent: (
    category: CommerceCategory,
    entrySource: CommerceEntrySource,
  ) => void;
  preserveIntent: (intent: CommercePurchaseIntent) => void;
  rememberLocatorShortfallOrigin: (origin: LocatorShortfallOrigin) => void;
}

const ENTRY_SOURCES: readonly CommerceEntrySource[] = [
  'profile',
  'stitch_coin_shortfall',
  'ai_credit_shortfall',
  'premium_benefit',
  'sign_in_return',
  'direct',
];

export const useCommerceIntentStore = create<CommerceIntentState>((set) => ({
  intent: null,
  locatorShortfallOrigin: null,
  // A category-level intent belongs to the authentication detour that created
  // it (#267). Abandoning that detour has to drop it, or a later Commerce
  // sign-in return would reopen a category the player never asked for. A
  // product-level intent is the player's own selection and is left alone.
  // The remembered Stitching Session belongs to that same detour (#268), even
  // after the category intent has become a product-level selection, so it is
  // dropped here too - but only when there is something to drop, so an
  // abandoned detour that preserved neither stays a no-op.
  clearCategoryIntent: () => set((state) => {
    const intent = state.intent !== null && state.intent.productKey === null
      ? null
      : state.intent;
    if (intent === state.intent && state.locatorShortfallOrigin === null) return state;
    return { intent, locatorShortfallOrigin: null };
  }),
  clearIntent: () => set({ intent: null }),
  clearLocatorShortfallOrigin: () => set({ locatorShortfallOrigin: null }),
  preserveCategoryIntent: (category, entrySource) => set({
    intent: { category, entrySource, productKey: null, productKind: null },
  }),
  preserveIntent: (intent) => set({ intent }),
  rememberLocatorShortfallOrigin: (origin) => set({ locatorShortfallOrigin: origin }),
}));

export function commerceEntrySource(value: string | string[] | undefined): CommerceEntrySource {
  const candidate = Array.isArray(value) ? value[0] : value;
  return ENTRY_SOURCES.includes(candidate as CommerceEntrySource)
    ? candidate as CommerceEntrySource
    : 'direct';
}

export function isCommerceReturnTarget(value: string | string[] | undefined): boolean {
  return (Array.isArray(value) ? value[0] : value) === 'commerce';
}
