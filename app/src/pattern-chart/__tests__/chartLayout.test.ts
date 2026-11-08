import {
  computeChartLayout,
  computeQrLayout,
  FOOTER_HEIGHT_PX,
  MAX_EDGE_PX,
  MIN_CANVAS_WIDTH_PX,
  TARGET_CELL_PX,
} from '../chartLayout';

describe('computeChartLayout', () => {
  it('uses 12 px cells for a small pattern', () => {
    const layout = computeChartLayout({ width: 50, height: 40, legendCount: 8 });
    expect(layout.cellSize).toBe(TARGET_CELL_PX);
    expect(layout.gridWidth).toBe(600);
    expect(layout.gridHeight).toBe(480);
    expect(layout.canvasWidth).toBe(648);
  });

  it('widens a tiny pattern to the minimum canvas width and centres the grid', () => {
    const layout = computeChartLayout({ width: 5, height: 5, legendCount: 2 });
    expect(layout.canvasWidth).toBe(MIN_CANVAS_WIDTH_PX);
    expect(layout.gridX).toBe((MIN_CANVAS_WIDTH_PX - 60) / 2);
  });

  it('stacks grid, legend, then footer without overlap', () => {
    const layout = computeChartLayout({ width: 60, height: 60, legendCount: 20 });
    expect(layout.legendY).toBeGreaterThanOrEqual(layout.gridY + layout.gridHeight);
    expect(layout.footerY).toBeGreaterThanOrEqual(layout.legendY + layout.legendHeight);
    expect(layout.canvasHeight).toBe(layout.footerY + FOOTER_HEIGHT_PX);
    expect(layout.legendRows * layout.legendColumns).toBeGreaterThanOrEqual(20);
  });

  it('shrinks cells so neither edge exceeds 4096 px', () => {
    const layout = computeChartLayout({ width: 500, height: 600, legendCount: 60 });
    expect(layout.cellSize).toBeLessThan(TARGET_CELL_PX);
    expect(layout.canvasWidth).toBeLessThanOrEqual(MAX_EDGE_PX);
    expect(layout.canvasHeight).toBeLessThanOrEqual(MAX_EDGE_PX);
    expect(layout.cellSize).toBeGreaterThanOrEqual(1);
  });

  it('keeps the largest cell size that still fits', () => {
    const layout = computeChartLayout({ width: 500, height: 600, legendCount: 60 });
    const bigger = layout.cellSize + 1;
    expect(500 * bigger + 48 > MAX_EDGE_PX || 600 * bigger + 48 + layout.legendHeight + FOOTER_HEIGHT_PX > MAX_EDGE_PX).toBe(true);
  });

  it('omits the legend gap when there are no colors', () => {
    const layout = computeChartLayout({ width: 10, height: 10, legendCount: 0 });
    expect(layout.legendHeight).toBe(0);
    expect(layout.footerY).toBe(layout.legendY);
  });

  it('rejects non-positive dimensions', () => {
    expect(() => computeChartLayout({ width: 0, height: 10, legendCount: 1 })).toThrow(RangeError);
    expect(() => computeChartLayout({ width: 10.5, height: 10, legendCount: 1 })).toThrow(RangeError);
  });
});

describe('computeQrLayout', () => {
  it('fits whole-pixel modules plus a 4-module quiet zone inside the target', () => {
    const layout = computeQrLayout(29);
    expect(layout.quietModules).toBe(4);
    expect(layout.moduleSize).toBe(Math.floor(160 / 37));
    expect(layout.totalSize).toBe(layout.moduleSize * 37);
    expect(layout.totalSize).toBeLessThanOrEqual(160);
  });

  it('keeps modules at least 3 px for a typical share link and fits the footer', () => {
    const layout = computeQrLayout(33);
    expect(layout.moduleSize).toBeGreaterThanOrEqual(3);
    expect(layout.totalSize).toBeLessThanOrEqual(FOOTER_HEIGHT_PX);
  });

  it('never returns a zero module size', () => {
    expect(computeQrLayout(177, 50).moduleSize).toBe(1);
  });
});
