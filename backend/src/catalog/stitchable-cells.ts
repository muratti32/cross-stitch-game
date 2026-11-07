export interface PatternCellCounts {
  width: number;
  height: number;
  stitchableCellCount: number | null;
}

export function stitchableCells({ width, height, stitchableCellCount }: PatternCellCounts): number {
  return stitchableCellCount ?? width * height;
}
