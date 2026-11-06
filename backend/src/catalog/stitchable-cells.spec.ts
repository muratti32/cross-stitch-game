import { stitchableCells } from './stitchable-cells';

describe('stitchableCells', () => {
  it('keeps width × height for a row with no count', () => {
    expect(stitchableCells({ width: 20, height: 20, stitchableCellCount: null })).toBe(400);
  });

  it('uses the stored count for a sparse Pattern', () => {
    expect(stitchableCells({ width: 20, height: 20, stitchableCellCount: 114 })).toBe(114);
  });
});
