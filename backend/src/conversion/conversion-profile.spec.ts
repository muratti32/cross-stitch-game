import {
  calculatePatternSize,
  resolveConversionSettings,
} from './conversion-profile';

describe('Pattern Conversion profile availability', () => {
  it('keeps Easy selectable at both framing aspect bounds', () => {
    expect(
      resolveConversionSettings({
        profile: 'easy',
        sourceHeight: 100,
        sourceWidth: 600,
      }),
    ).toEqual({ height: 50, maxColors: 12, shortEdgeCells: 50, width: 300 });
    expect(
      resolveConversionSettings({
        profile: 'easy',
        sourceHeight: 600,
        sourceWidth: 100,
      }),
    ).toEqual({ height: 300, maxColors: 12, shortEdgeCells: 50, width: 50 });
  });

  it('makes a profile unavailable instead of silently clamping its long edge', () => {
    expect(() =>
      resolveConversionSettings({
        profile: 'standard',
        sourceHeight: 100,
        sourceWidth: 400,
      }),
    ).toThrow('standard is unavailable');
  });

  it('enforces custom cell and color bounds while preserving shape', () => {
    expect(
      resolveConversionSettings({
        customMaxColors: 60,
        customShortEdgeCells: 120,
        profile: 'custom',
        sourceHeight: 200,
        sourceWidth: 300,
      }),
    ).toEqual({ height: 120, maxColors: 60, shortEdgeCells: 120, width: 180 });
    expect(() =>
      resolveConversionSettings({
        customMaxColors: 4,
        customShortEdgeCells: 20,
        profile: 'custom',
        sourceHeight: 100,
        sourceWidth: 100,
      }),
    ).toThrow('between 5 and 60');
  });

  it('rejects framing outside 1:6 through 6:1', () => {
    expect(() => calculatePatternSize(601, 100, 50)).toThrow(
      'between 1:6 and 6:1',
    );
  });
});
