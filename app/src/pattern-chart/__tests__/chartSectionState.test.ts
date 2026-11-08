import type { PatternChartAccess } from '../../api/patternCharts';
import { decideChartSection, type ChartSectionInput } from '../chartSectionState';

const entitled = (availability: 'available' | 'withdrawn' | 'review_hold' = 'available'): PatternChartAccess => ({ status: 'entitled', price: 20, availability });
const purchasable = (availability: 'available' | 'withdrawn' = 'available'): PatternChartAccess => ({ status: 'purchasable', price: 20, availability });

function input(overrides: Partial<ChartSectionInput> = {}): ChartSectionInput {
  return {
    isAuthenticated: true,
    isAccount: true,
    variant: 'detail',
    isOfficial: true,
    canStart: true,
    hasLocalData: false,
    locallyCompleted: false,
    access: { isLoading: false, isError: false, data: entitled() },
    ...overrides,
  };
}
const access = (data?: PatternChartAccess, flags: { isLoading?: boolean; isError?: boolean } = {}) => ({ isLoading: false, isError: false, data, ...flags });

describe('decideChartSection', () => {
  it('excludes non-Official patterns and missing identity', () => {
    expect(decideChartSection(input({ isOfficial: false })).kind).toBe('hidden');
    expect(decideChartSection(input({ isAuthenticated: false, isAccount: false })).kind).toBe('hidden');
  });

  it('asks Guests to sign in on every surface of an Official Pattern, and never lets them draw locally', () => {
    expect(decideChartSection(input({ isAccount: false })).kind).toBe('signIn');
    expect(decideChartSection(input({ isAccount: false, variant: 'compact' })).kind).toBe('signIn');
    expect(decideChartSection(input({ isAccount: false, variant: 'compact', locallyCompleted: true, hasLocalData: true })).kind).toBe('signIn');
    expect(decideChartSection(input({ isAccount: false, variant: 'compact', isOfficial: undefined })).kind).toBe('hidden');
  });

  it('covers loading, error and ineligible', () => {
    expect(decideChartSection(input({ access: access(undefined, { isLoading: true }) })).kind).toBe('loading');
    expect(decideChartSection(input({ access: access(undefined, { isError: true }) })).kind).toBe('error');
    expect(decideChartSection(input({ access: access({ status: 'ineligible' }) })).kind).toBe('hidden');
  });

  it('sells only on detail, when startable and available', () => {
    expect(decideChartSection(input({ access: access(purchasable()) }))).toEqual({ kind: 'buy', price: 20, removed: false });
    expect(decideChartSection(input({ access: access(purchasable()), canStart: false })).kind).toBe('hidden');
    expect(decideChartSection(input({ access: access(purchasable()), variant: 'compact' })).kind).toBe('hidden');
    expect(decideChartSection(input({ access: access(purchasable('withdrawn')) })).kind).toBe('hidden');
  });

  it('generates with remote fetch allowed for an entitled, available pattern', () => {
    expect(decideChartSection(input())).toEqual({ kind: 'generate', allowRemoteFetch: true, removed: false });
  });

  it('Catalog Withdrawal: Generate only from local data, never fetch', () => {
    expect(decideChartSection(input({ access: access(entitled('withdrawn')) })).kind).toBe('hidden');
    expect(decideChartSection(input({ access: access(entitled('withdrawn')), hasLocalData: true }))).toEqual({ kind: 'generate', allowRemoteFetch: false, removed: false });
    expect(decideChartSection(input({ access: access(entitled('review_hold')), hasLocalData: true }))).toMatchObject({ allowRemoteFetch: false });
  });

  it('Safety Removal: hidden everywhere, even with local data or a local completion, and flags deletion', () => {
    const removed = access({ status: 'removed' });
    expect(decideChartSection(input({ access: removed, hasLocalData: true }))).toEqual({ kind: 'hidden', removed: true });
    expect(decideChartSection(input({ access: removed, hasLocalData: true, locallyCompleted: true, variant: 'compact' }))).toEqual({ kind: 'hidden', removed: true });
  });

  describe('local completion fast path', () => {
    const base = { variant: 'compact' as const, locallyCompleted: true, hasLocalData: true, isOfficial: true as boolean | undefined };

    it('generates offline (request errored) only for a known Official pattern, from local data', () => {
      expect(decideChartSection(input({ ...base, access: access(undefined, { isError: true }) }))).toEqual({ kind: 'generate', allowRemoteFetch: false, removed: false });
    });

    it('generates when the server already answers entitled', () => {
      expect(decideChartSection(input({ ...base, access: access(entitled()) }))).toEqual({ kind: 'generate', allowRemoteFetch: true, removed: false });
    });

    it('shows loading, not the fast path, while online and the request is pending', () => {
      expect(decideChartSection(input({ ...base, access: access(undefined, { isLoading: true }) })).kind).toBe('loading');
    });

    it('generates from local data when the server has not accepted the completion yet (purchasable)', () => {
      expect(decideChartSection(input({ ...base, access: access(purchasable()) }))).toEqual({ kind: 'generate', allowRemoteFetch: false, removed: false });
    });

    it.each([undefined, false])('never generates offline when isOfficial is %s', (isOfficial) => {
      const state = decideChartSection(input({ ...base, isOfficial, access: access(undefined, { isError: true }) }));
      expect(state.kind).not.toBe('generate');
    });
  });

  it('a local completion of a pattern the server calls ineligible stays hidden', () => {
    expect(decideChartSection(input({ locallyCompleted: true, hasLocalData: true, isOfficial: true, access: access({ status: 'ineligible' }) })).kind).toBe('hidden');
  });
});
