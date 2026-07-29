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
  readonly productKey: PurchaseProductKey;
  readonly productKind: PurchaseProductKind;
}

interface CommerceIntentState {
  intent: CommercePurchaseIntent | null;
  clearIntent: () => void;
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
  clearIntent: () => set({ intent: null }),
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
