import type { PatternData } from '../../pattern-artifact';
import { buildChartDrawPlan, BRAND_TEXT, usedPaletteIndexes } from '../chartDrawPlan';
import { buildQrMatrix } from '../qrMatrix';

function pattern(width: number, height: number, cells: number[]): PatternData {
  return {
    schemaVersion: 1,
    width,
    height,
    palette: [
      { dmcCode: '310', name: 'Black', rgbHex: '#000000' },
      { dmcCode: '666', name: 'Red', rgbHex: '#E31D42' },
      { dmcCode: '700', name: 'Unused', rgbHex: '#07A04D' },
    ],
    grid: Uint8Array.from(cells),
  };
}

describe('buildChartDrawPlan', () => {
  const qr = buildQrMatrix('https://example.test/pattern/x');
  const data = pattern(4, 2, [1, 1, 2, 0, 0, 2, 2, 2]);
  const plan = buildChartDrawPlan(data, qr);

  it('lists only used palette entries in the legend', () => {
    expect(usedPaletteIndexes(data)).toEqual([1, 2]);
    const legend = plan.ops.filter((op) => op.type === 'text' && op.text.startsWith('DMC'));
    expect(legend.map((op) => (op.type === 'text' ? op.text : ''))).toEqual(['DMC 310', 'DMC 666']);
  });

  it('merges horizontal runs of one color and skips empty cells', () => {
    const { cellSize, gridX, gridY } = plan.layout;
    const cellRects = plan.ops.filter(
      (op) => op.type === 'rect' && op.y >= gridY && op.y < gridY + plan.layout.gridHeight && op.x >= gridX && op.color !== '#FFFFFF' && op.height === cellSize,
    );
    expect(cellRects).toEqual([
      { type: 'rect', x: gridX, y: gridY, width: 2 * cellSize, height: cellSize, color: '#000000' },
      { type: 'rect', x: gridX + 2 * cellSize, y: gridY, width: cellSize, height: cellSize, color: '#E31D42' },
      { type: 'rect', x: gridX + cellSize, y: gridY + cellSize, width: 3 * cellSize, height: cellSize, color: '#E31D42' },
    ]);
  });

  it('draws a bold line every 10 cells and on the border', () => {
    const wide = buildChartDrawPlan(pattern(25, 1, new Array(25).fill(1)), qr);
    const vertical = wide.ops.filter((op) => op.type === 'line' && op.x1 === op.x2);
    const boldXs = vertical.filter((op) => op.type === 'line' && op.strokeWidth === 2).map((op) => (op.type === 'line' ? (op.x1 - wide.layout.gridX) / wide.layout.cellSize : -1));
    expect(boldXs).toEqual([0, 10, 20, 25]);
    expect(vertical).toHaveLength(26);
  });

  it('puts the brand and a QR code in the footer, inside the canvas', () => {
    const brand = plan.ops.find((op) => op.type === 'text' && op.text === BRAND_TEXT);
    expect(brand).toBeDefined();
    const darkModules = plan.ops.filter((op) => op.type === 'rect' && op.color === '#000000' && op.y >= plan.layout.footerY);
    const expectedDark = qr.flat().filter(Boolean).length;
    expect(darkModules).toHaveLength(expectedDark);
    darkModules.forEach((op) => {
      if (op.type === 'rect') {
        expect(op.x + op.width).toBeLessThanOrEqual(plan.layout.canvasWidth);
        expect(op.y + op.height).toBeLessThanOrEqual(plan.layout.canvasHeight);
      }
    });
  });

  it('falls back to a neutral swatch for a malformed color', () => {
    const bad = pattern(1, 1, [1]);
    bad.palette[0] = { dmcCode: '1', name: 'x', rgbHex: 'red' };
    const badPlan = buildChartDrawPlan(bad, qr);
    expect(badPlan.ops.some((op) => op.type === 'rect' && op.color === '#CCCCCC')).toBe(true);
  });
});
