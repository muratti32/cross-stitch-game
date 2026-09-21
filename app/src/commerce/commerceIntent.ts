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

interface CommerceIntentState {
  intent: CommercePurchaseIntent | null;
  clearCategoryIntent: () => void;
  clearIntent: () => void;
  preserveCategoryIntent: (
    category: CommerceCategory,
    entrySource: CommerceEntrySource,
  ) => void;
  preserveIntent: (intent: CommercePurchaseIntent) => void;
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
  // A category-level intent belongs to the authentication detour that created
  // it (#267). Abandoning that detour has to drop it, or a later Commerce
  // sign-in return would reopen a category the player never asked for. A
  // product-level intent is the player's own selection and is left alone.
  clearCategoryIntent: () => set((state) => (
    state.intent !== null && state.intent.productKey === null ? { intent: null } : state
  )),
  clearIntent: () => set({ intent: null }),
  preserveCategoryIntent: (category, entrySource) => set({
    intent: { category, entrySource, productKey: null, productKind: null },
  }),
  preserveIntent: (intent) => set({ intent }),
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
