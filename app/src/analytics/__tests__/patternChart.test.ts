import { captureGameplayEvent } from '../gameplayEvents';
import { chartTierForPrice, recordChartPurchaseResult } from '../patternChart';

jest.mock('../gameplayEvents', () => ({ captureGameplayEvent: jest.fn() }));
const capture = captureGameplayEvent as jest.MockedFunction<typeof captureGameplayEvent>;

describe('pattern chart analytics', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([[20, 'small'], [40, 'medium'], [60, 'large']] as const)('maps price %i to %s', (price, tier) => {
    expect(chartTierForPrice(price)).toBe(tier);
  });

  it('returns null for a price outside the tier table', () => {
    expect(chartTierForPrice(75)).toBeNull();
  });

  it('emits pattern_chart_purchased after a real charge', () => {
    recordChartPurchaseResult({ alreadyEntitled: false, price: 40 });
    expect(capture).toHaveBeenCalledWith('pattern_chart_purchased', { tier: 'medium', price: 40 });
  });

  it('does not emit for an already-entitled replay or an unknown price', () => {
    recordChartPurchaseResult({ alreadyEntitled: true, price: 40 });
    recordChartPurchaseResult({ alreadyEntitled: false, price: 99 });
    expect(capture).not.toHaveBeenCalled();
  });
});
