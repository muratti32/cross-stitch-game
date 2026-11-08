import { captureGameplayEvent } from '../gameplayEvents';
import { recordChartPurchaseResult } from '../patternChart';

jest.mock('../gameplayEvents', () => ({ captureGameplayEvent: jest.fn() }));
const capture = captureGameplayEvent as jest.MockedFunction<typeof captureGameplayEvent>;

describe('pattern chart analytics', () => {
  beforeEach(() => jest.clearAllMocks());

  it('emits pattern_chart_purchased with the server tier after a real charge', () => {
    recordChartPurchaseResult({ alreadyEntitled: false, price: 40, tier: 'medium' });
    expect(capture).toHaveBeenCalledWith('pattern_chart_purchased', { tier: 'medium', price: 40 });
  });

  it('does not emit for an already-entitled replay', () => {
    recordChartPurchaseResult({ alreadyEntitled: true, price: 40, tier: 'medium' });
    expect(capture).not.toHaveBeenCalled();
  });
});
