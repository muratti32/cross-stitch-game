import type { PatternChartAccess } from '../api/patternCharts';

export interface ChartSectionInput {
  isAuthenticated: boolean;
  isAccount: boolean;
  variant: 'detail' | 'compact';
  /** False for Community/Personal; undefined when unknown. */
  isOfficial: boolean | undefined;
  /** Detail only: the player may already start the pattern. */
  canStart: boolean;
  /** Pattern data or Offline Pattern Data exists on this device. */
  hasLocalData: boolean;
  /** This device holds a completed session of the pattern. */
  locallyCompleted: boolean;
  access: { isLoading: boolean; isError: boolean; data: PatternChartAccess | undefined };
}

export type ChartSectionState =
  | { kind: 'hidden'; removed: boolean }
  | { kind: 'signIn'; removed: false }
  | { kind: 'loading'; removed: false }
  | { kind: 'error'; removed: false }
  | { kind: 'buy'; price: number; removed: false }
  /** `allowRemoteFetch` is false whenever drawing must use data already on the device. */
  | { kind: 'generate'; allowRemoteFetch: boolean; removed: false };

const hidden = (removed = false): ChartSectionState => ({ kind: 'hidden', removed });

/**
 * ADR-0068 gating in one pure place: Official + Registered Account only;
 * Safety Removal never draws; Catalog Withdrawal draws only from local data
 * and never sells or fetches; a locally completed session draws at once.
 */
export function decideChartSection(input: ChartSectionInput): ChartSectionState {
  if (input.isOfficial === false || !input.isAuthenticated) return hidden();
  if (!input.isAccount) {
    return input.variant === 'detail' && input.isOfficial === true ? { kind: 'signIn', removed: false } : hidden();
  }
  const data = input.access.data;
  if (data?.status === 'removed') return hidden(true);
  if (data?.status === 'ineligible') return hidden();

  const available = data !== undefined && data.availability === 'available';
  const entitled = data?.status === 'entitled';

  if (input.locallyCompleted && input.hasLocalData) {
    return { kind: 'generate', allowRemoteFetch: entitled && available, removed: false };
  }
  if (input.access.isLoading) return { kind: 'loading', removed: false };
  if (input.access.isError || data === undefined) return { kind: 'error', removed: false };

  if (data.status === 'purchasable') {
    return input.variant === 'detail' && input.canStart && available
      ? { kind: 'buy', price: data.price, removed: false }
      : hidden();
  }
  if (available) return { kind: 'generate', allowRemoteFetch: true, removed: false };
  return input.hasLocalData ? { kind: 'generate', allowRemoteFetch: false, removed: false } : hidden();
}
