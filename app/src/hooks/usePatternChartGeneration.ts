import { useCallback, useState } from 'react';
import { generatePatternChart, type GeneratePatternChartInput } from '../pattern-chart/generatePatternChart';

export type ChartGenerationState =
  | { phase: 'idle' }
  | { phase: 'generating' }
  | { phase: 'error'; error: unknown };

/** Tracks one Pattern Chart generation so the button can show loading and the failure. */
export function usePatternChartGeneration() {
  const [state, setState] = useState<ChartGenerationState>({ phase: 'idle' });
  const generate = useCallback(async (input: GeneratePatternChartInput) => {
    setState({ phase: 'generating' });
    try {
      await generatePatternChart(input);
      setState({ phase: 'idle' });
    } catch (error) {
      setState({ phase: 'error', error });
    }
  }, []);
  const clearError = useCallback(() => setState({ phase: 'idle' }), []);
  return { state, generate, clearError };
}
