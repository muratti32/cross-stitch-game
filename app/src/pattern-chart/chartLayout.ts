/**
 * Pure layout math for the Pattern Chart Image (ADR-0068). Everything here is
 * integer pixel geometry derived from the pattern size and legend length; the
 * Skia renderer only executes what chartDrawPlan.ts builds from it.
 */

export const TARGET_CELL_PX = 12;
export const MAX_EDGE_PX = 4096;
export const BOLD_LINE_EVERY = 10;
export const MARGIN_PX = 24;
export const MIN_CANVAS_WIDTH_PX = 480;
export const LEGEND_ENTRY_WIDTH_PX = 168;
export const LEGEND_ROW_HEIGHT_PX = 36;
export const LEGEND_SWATCH_PX = 24;
export const FOOTER_HEIGHT_PX = 192;
export const QR_TARGET_PX = 160;
export const QR_QUIET_MODULES = 4;

export interface ChartLayoutInput {
  width: number;
  height: number;
  legendCount: number;
}

export interface ChartLayout {
  cellSize: number;
  canvasWidth: number;
  canvasHeight: number;
  gridX: number;
  gridY: number;
  gridWidth: number;
  gridHeight: number;
  legendY: number;
  legendColumns: number;
  legendRows: number;
  legendHeight: number;
  footerY: number;
  footerHeight: number;
}

export interface QrLayout {
  moduleSize: number;
  quietModules: number;
  totalSize: number;
}

function legendMetrics(canvasWidth: number, legendCount: number): { columns: number; rows: number; height: number } {
  const columns = Math.max(1, Math.floor((canvasWidth - 2 * MARGIN_PX) / LEGEND_ENTRY_WIDTH_PX));
  const rows = legendCount > 0 ? Math.ceil(legendCount / columns) : 0;
  return { columns, rows, height: rows * LEGEND_ROW_HEIGHT_PX };
}

function layoutForCell(input: ChartLayoutInput, cellSize: number): ChartLayout {
  const gridWidth = input.width * cellSize;
  const gridHeight = input.height * cellSize;
  const canvasWidth = Math.max(MIN_CANVAS_WIDTH_PX, gridWidth + 2 * MARGIN_PX);
  const legend = legendMetrics(canvasWidth, input.legendCount);
  const gridX = Math.floor((canvasWidth - gridWidth) / 2);
  const gridY = MARGIN_PX;
  const legendY = gridY + gridHeight + MARGIN_PX;
  const footerY = legendY + legend.height + (legend.height > 0 ? MARGIN_PX : 0);
  return {
    cellSize,
    canvasWidth,
    canvasHeight: footerY + FOOTER_HEIGHT_PX,
    gridX,
    gridY,
    gridWidth,
    gridHeight,
    legendY,
    legendColumns: legend.columns,
    legendRows: legend.rows,
    legendHeight: legend.height,
    footerY,
    footerHeight: FOOTER_HEIGHT_PX,
  };
}

/**
 * 12 px per cell, shrunk (never below 1 px) until the whole canvas, including
 * legend and footer, fits the longest-edge cap.
 */
export function computeChartLayout(input: ChartLayoutInput): ChartLayout {
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width < 1 || input.height < 1) {
    throw new RangeError('Pattern dimensions must be positive integers');
  }
  for (let cell = TARGET_CELL_PX; cell > 1; cell -= 1) {
    const layout = layoutForCell(input, cell);
    if (layout.canvasWidth <= MAX_EDGE_PX && layout.canvasHeight <= MAX_EDGE_PX) {
      return layout;
    }
  }
  return layoutForCell(input, 1);
}

/** Quiet zone included; the largest whole-pixel module size within the target. */
export function computeQrLayout(matrixSize: number, targetPx: number = QR_TARGET_PX): QrLayout {
  const modulesWithQuiet = matrixSize + 2 * QR_QUIET_MODULES;
  const moduleSize = Math.max(1, Math.floor(targetPx / modulesWithQuiet));
  return { moduleSize, quietModules: QR_QUIET_MODULES, totalSize: moduleSize * modulesWithQuiet };
}
