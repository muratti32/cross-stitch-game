export interface PatternCellCounts {
  width: number;
  height: number;
  stitchableCellCount: number | null;
}

/**
 * Cells a player must stitch to finish a Pattern. Null means a full grid, so
 * every row published before the column existed keeps width × height. Bitmap
 * sizing and cell indices stay on the grid, not this count.
 */
export function stitchableCells({ width, height, stitchableCellCount }: PatternCellCounts): number {
  return stitchableCellCount ?? width * height;
}
