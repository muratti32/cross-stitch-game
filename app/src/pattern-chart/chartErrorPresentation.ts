import { PatternChartError } from '../api/patternCharts';
import { ChartSharingUnavailableError } from './chartErrors';
import { ChartDataUnavailableError } from './loadChartPattern';

export type ChartErrorPresentation =
  | { type: 'key'; key: string; values?: Record<string, number> }
  | { type: 'insufficient'; price: number; balance: number }
  | { type: 'server'; error: Error };

/** Pure mapping of any chart failure to what the player sees; unknown failures use the generic text. */
export function presentChartError(error: unknown): ChartErrorPresentation {
  if (error instanceof ChartSharingUnavailableError) return { type: 'key', key: 'chart.sharingUnavailable' };
  if (error instanceof ChartDataUnavailableError) return { type: 'key', key: 'chart.unavailable' };
  if (error instanceof PatternChartError) {
    switch (error.kind) {
      case 'removed':
      case 'unavailable':
      case 'not_found':
        return { type: 'key', key: 'chart.unavailable' };
      case 'unlock_required':
      case 'chart_required':
        return { type: 'key', key: 'chart.accessRequired' };
      case 'price_changed':
        return error.price === null
          ? { type: 'key', key: 'chart.generateFailed' }
          : { type: 'key', key: 'chart.priceChanged', values: { price: error.price } };
      case 'insufficient_balance':
        return error.price === null || error.balance === null
          ? { type: 'key', key: 'chart.generateFailed' }
          : { type: 'insufficient', price: error.price, balance: error.balance };
      case 'account_required':
      case 'other':
        return { type: 'server', error };
    }
  }
  return { type: 'key', key: 'chart.generateFailed' };
}
