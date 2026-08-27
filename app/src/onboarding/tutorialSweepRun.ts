export function findTutorialSweepRunStart(
  grid: Uint8Array,
  width: number,
  height: number,
  activeColorIndex: number,
  isCompleted: (cellIndex: number) => boolean,
): number {
  let longestRunStart = -1;
  let longestRunLength = 0;

  for (let y = 0; y < height; y++) {
    let runStart = -1;
    let runLength = 0;
    for (let x = 0; x < width; x++) {
      const cellIndex = y * width + x;
      if (grid[cellIndex] - 1 === activeColorIndex && !isCompleted(cellIndex)) {
        if (runLength === 0) runStart = cellIndex;
        runLength += 1;
      } else {
        if (runLength > longestRunLength) {
          longestRunStart = runStart;
          longestRunLength = runLength;
        }
        runStart = -1;
        runLength = 0;
      }
    }
    if (runLength > longestRunLength) {
      longestRunStart = runStart;
      longestRunLength = runLength;
    }
  }

  return longestRunLength >= 3 ? longestRunStart : -1;
}
