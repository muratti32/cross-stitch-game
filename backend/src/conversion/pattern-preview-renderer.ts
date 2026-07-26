import { PNG } from 'pngjs';

export function renderPatternPreviewPng(input: {
  width: number;
  height: number;
  palette: { dmcCode: string; name: string; rgbHex: string }[];
  grid: Uint8Array;
}): Buffer {
  if (input.width < 1 || input.width > 300 || input.height < 1 || input.height > 300) {
    throw new Error(`Invalid dimensions: ${input.width}x${input.height}`);
  }
  if (input.grid.length !== input.width * input.height) {
    throw new Error(
      `Grid length ${input.grid.length} does not match dimensions ${input.width}x${input.height}`,
    );
  }

  const blockSize = Math.max(
    1,
    Math.floor(512 / Math.max(input.width, input.height)),
  );
  const previewWidth = input.width * blockSize;
  const previewHeight = input.height * blockSize;

  const png = new PNG({ width: previewWidth, height: previewHeight });

  for (let r = 0; r < input.height; r++) {
    for (let c = 0; c < input.width; c++) {
      const i = r * input.width + c;
      const cellValue = input.grid[i];
      // Unstitched cells are fully transparent (0,0,0,0) so Pattern Preview matches conversion engine renderer byte-for-byte in behaviour
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;

      if (cellValue !== 0) {
        const paletteEntry = input.palette[cellValue - 1];
        if (paletteEntry) {
          const hex = paletteEntry.rgbHex;
          red = parseInt(hex.substring(1, 3), 16);
          green = parseInt(hex.substring(3, 5), 16);
          blue = parseInt(hex.substring(5, 7), 16);
          alpha = 255;
        }
      }

      for (let by = 0; by < blockSize; by++) {
        for (let bx = 0; bx < blockSize; bx++) {
          const px = c * blockSize + bx;
          const py = r * blockSize + by;
          const idx = (previewWidth * py + px) * 4;
          png.data[idx] = red;
          png.data[idx + 1] = green;
          png.data[idx + 2] = blue;
          png.data[idx + 3] = alpha;
        }
      }
    }
  }

  return PNG.sync.write(png);
}
