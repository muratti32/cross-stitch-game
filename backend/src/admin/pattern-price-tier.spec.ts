import { deriveUnlockPriceTier } from './pattern-price-tier';

describe('deriveUnlockPriceTier', () => {
  it('is always null for a free pattern regardless of stitchable cell count', () => {
    expect(deriveUnlockPriceTier(false, 1)).toBeNull();
    expect(deriveUnlockPriceTier(false, 50_000)).toBeNull();
  });

  it.each([
    [1, 'small'],
    [3_999, 'small'],
    [4_000, 'medium'],
    [14_999, 'medium'],
    [15_000, 'large'],
    [100_000, 'large'],
  ] as const)(
    'derives %s stitchable cells -> %s for a paid pattern',
    (stitchableCellCount, tier) => {
      expect(deriveUnlockPriceTier(true, stitchableCellCount)).toBe(tier);
    },
  );

  it('rejects a non-positive or non-integer stitchable cell count for a paid pattern', () => {
    expect(() => deriveUnlockPriceTier(true, 0)).toThrow(RangeError);
    expect(() => deriveUnlockPriceTier(true, -5)).toThrow(RangeError);
    expect(() => deriveUnlockPriceTier(true, 1.5)).toThrow(RangeError);
  });
});
