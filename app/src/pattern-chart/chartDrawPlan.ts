import type { PatternData } from '../pattern-artifact';
import {
  BOLD_LINE_EVERY,
  computeChartLayout,
  computeQrLayout,
  LEGEND_ENTRY_WIDTH_PX,
  LEGEND_ROW_HEIGHT_PX,
  LEGEND_SWATCH_PX,
  MARGIN_PX,
  type ChartLayout,
} from './chartLayout';

export const BRAND_TEXT = 'Stitch Wish';
const BACKGROUND = '#FFFFFF';
const THIN_LINE = '#D6D2CC';
const BOLD_LINE = '#2C2C2C';
const TEXT_COLOR = '#2C2C2C';

export type DrawOp =
  | { type: 'rect'; x: number; y: number; width: number; height: number; color: string }
  | { type: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; strokeWidth: number }
  | { type: 'text'; x: number; y: number; text: string; size: number; bold: boolean; color: string };

export interface ChartDrawPlan {
  layout: ChartLayout;
  ops: DrawOp[];
}

function safeHex(rgbHex: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(rgbHex) ? rgbHex : '#CCCCCC';
}

/** Used palette entries in palette order, so the legend lists only threads the chart shows. */
export function usedPaletteIndexes(pattern: PatternData): number[] {
  const used = new Set<number>();
  for (let i = 0; i < pattern.grid.length; i += 1) {
    const value = pattern.grid[i];
    if (value > 0 && value <= pattern.palette.length) used.add(value);
  }
  return [...used].sort((a, b) => a - b);
}

export function buildChartDrawPlan(pattern: PatternData, qr: boolean[][]): ChartDrawPlan {
  const used = usedPaletteIndexes(pattern);
  const layout = computeChartLayout({ width: pattern.width, height: pattern.height, legendCount: used.length });
  const { cellSize, gridX, gridY } = layout;
  const ops: DrawOp[] = [
    { type: 'rect', x: 0, y: 0, width: layout.canvasWidth, height: layout.canvasHeight, color: BACKGROUND },
  ];

  // Cells: horizontal runs of one color are one rect to keep the op list small.
  for (let y = 0; y < pattern.height; y += 1) {
    let x = 0;
    while (x < pattern.width) {
      const value = pattern.grid[y * pattern.width + x];
      if (value === 0 || value > pattern.palette.length) {
        x += 1;
        continue;
      }
      let end = x + 1;
      while (end < pattern.width && pattern.grid[y * pattern.width + end] === value) end += 1;
      ops.push({
        type: 'rect',
        x: gridX + x * cellSize,
        y: gridY + y * cellSize,
        width: (end - x) * cellSize,
        height: cellSize,
        color: safeHex(pattern.palette[value - 1].rgbHex),
      });
      x = end;
    }
  }

  // Grid lines: thin per cell, bold every 10th (and the outer border).
  for (let x = 0; x <= pattern.width; x += 1) {
    const bold = x % BOLD_LINE_EVERY === 0 || x === pattern.width;
    if (cellSize === 1 && !bold) continue;
    ops.push({
      type: 'line',
      x1: gridX + x * cellSize,
      y1: gridY,
      x2: gridX + x * cellSize,
      y2: gridY + layout.gridHeight,
      color: bold ? BOLD_LINE : THIN_LINE,
      strokeWidth: bold ? 2 : 1,
    });
  }
  for (let y = 0; y <= pattern.height; y += 1) {
    const bold = y % BOLD_LINE_EVERY === 0 || y === pattern.height;
    if (cellSize === 1 && !bold) continue;
    ops.push({
      type: 'line',
      x1: gridX,
      y1: gridY + y * cellSize,
      x2: gridX + layout.gridWidth,
      y2: gridY + y * cellSize,
      color: bold ? BOLD_LINE : THIN_LINE,
      strokeWidth: bold ? 2 : 1,
    });
  }

  // Legend: swatch paired with its DMC code.
  used.forEach((paletteValue, i) => {
    const column = i % layout.legendColumns;
    const row = Math.floor(i / layout.legendColumns);
    const x = MARGIN_PX + column * LEGEND_ENTRY_WIDTH_PX;
    const y = layout.legendY + row * LEGEND_ROW_HEIGHT_PX;
    const entry = pattern.palette[paletteValue - 1];
    ops.push({ type: 'rect', x, y, width: LEGEND_SWATCH_PX, height: LEGEND_SWATCH_PX, color: safeHex(entry.rgbHex) });
    ops.push({
      type: 'text',
      x: x + LEGEND_SWATCH_PX + 8,
      y: y + LEGEND_SWATCH_PX - 6,
      text: `DMC ${entry.dmcCode}`,
      size: 16,
      bold: false,
      color: TEXT_COLOR,
    });
  });

  // Footer: brand left, QR right.
  const qrLayout = computeQrLayout(qr.length);
  const qrX = layout.canvasWidth - MARGIN_PX - qrLayout.totalSize;
  const qrY = layout.footerY + Math.floor((layout.footerHeight - qrLayout.totalSize) / 2);
  ops.push({
    type: 'text',
    x: MARGIN_PX,
    y: layout.footerY + Math.floor(layout.footerHeight / 2) + 10,
    text: BRAND_TEXT,
    size: 32,
    bold: true,
    color: TEXT_COLOR,
  });
  ops.push({ type: 'rect', x: qrX, y: qrY, width: qrLayout.totalSize, height: qrLayout.totalSize, color: BACKGROUND });
  qr.forEach((rowModules, r) => {
    rowModules.forEach((dark, c) => {
      if (!dark) return;
      ops.push({
        type: 'rect',
        x: qrX + (c + qrLayout.quietModules) * qrLayout.moduleSize,
        y: qrY + (r + qrLayout.quietModules) * qrLayout.moduleSize,
        width: qrLayout.moduleSize,
        height: qrLayout.moduleSize,
        color: '#000000',
      });
    });
  });

  return { layout, ops };
}
