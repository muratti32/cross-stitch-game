import { mapPatternChartError } from '../../api/patternCharts';
import { ChartSharingUnavailableError } from '../chartErrors';
import { ChartDataUnavailableError } from '../loadChartPattern';
import { presentChartError } from '../chartErrorPresentation';

jest.mock('../../api/apiFetch', () => ({ apiFetch: jest.fn() }));

describe('presentChartError', () => {
  it('maps removal and withdrawal to the unavailable text', () => {
    expect(presentChartError(mapPatternChartError(410, { code: 'pattern_removed' }))).toEqual({ type: 'key', key: 'chart.unavailable' });
    expect(presentChartError(mapPatternChartError(410, { code: 'pattern_unavailable' }))).toEqual({ type: 'key', key: 'chart.unavailable' });
  });

  it('maps access errors', () => {
    expect(presentChartError(mapPatternChartError(403, { code: 'unlock_required', price: 75 }))).toEqual({ type: 'key', key: 'chart.accessRequired' });
    expect(presentChartError(mapPatternChartError(403, { code: 'pattern_chart_required' }))).toEqual({ type: 'key', key: 'chart.accessRequired' });
  });

  it('carries the new server price on a price change', () => {
    expect(presentChartError(mapPatternChartError(409, { code: 'pattern_chart_price_changed', price: 60 }))).toEqual({ type: 'priceChanged', price: 60 });
  });

  it('reports insufficient balance with price and balance', () => {
    expect(presentChartError(mapPatternChartError(409, { code: 'insufficient_balance', price: 40, balance: 5 }))).toEqual({ type: 'insufficient', price: 40, balance: 5 });
  });

  it('defers unknown server failures to the shared server error presenter', () => {
    const error = mapPatternChartError(500, null);
    expect(presentChartError(error)).toEqual({ type: 'server', error });
  });

  it('maps missing local data under withdrawal to unavailable', () => {
    expect(presentChartError(new ChartDataUnavailableError())).toEqual({ type: 'key', key: 'chart.unavailable' });
  });

  it('handles sharing unavailability and non-server failures', () => {
    expect(presentChartError(new ChartSharingUnavailableError())).toEqual({ type: 'key', key: 'chart.sharingUnavailable' });
    expect(presentChartError(new Error('decode'))).toEqual({ type: 'key', key: 'chart.generateFailed' });
  });
});
