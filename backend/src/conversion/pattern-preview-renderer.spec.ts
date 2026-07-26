import { PNG } from 'pngjs';
import { renderPatternPreviewPng } from './pattern-preview-renderer';

describe('Pattern Preview Renderer', () => {
  it('renders a tiny 2x2 grid with a 1-entry palette', () => {
    const width = 2;
    const height = 2;
    const palette = [{ dmcCode: '310', name: 'Black', rgbHex: '#000000' }];
    const grid = new Uint8Array([1, 0, 1, 0]);

    const buf = renderPatternPreviewPng({ width, height, palette, grid });
    const png = PNG.sync.read(buf);

    const blockSize = Math.max(1, Math.floor(512 / Math.max(width, height)));
    expect(png.width).toBe(width * blockSize);
    expect(png.height).toBe(height * blockSize);

    // Assert pixel (0,0) (col 0, row 0) is black (0,0,0,255)
    const idx00 = (png.width * 0 + 0) * 4;
    expect(png.data[idx00]).toBe(0);
    expect(png.data[idx00 + 1]).toBe(0);
    expect(png.data[idx00 + 2]).toBe(0);
    expect(png.data[idx00 + 3]).toBe(255);

    // Assert pixel (1,0) (col 1, row 0) is transparent (0,0,0,0)
    const idx10 = (png.width * 0 + blockSize) * 4;
    expect(png.data[idx10]).toBe(0);
    expect(png.data[idx10 + 1]).toBe(0);
    expect(png.data[idx10 + 2]).toBe(0);
    expect(png.data[idx10 + 3]).toBe(0);
  });

  it('renders every unstitched cell as fully transparent', () => {
    const width = 3;
    const height = 2;
    const palette = [
      { dmcCode: '310', name: 'Black', rgbHex: '#000000' },
      { dmcCode: '666', name: 'Bright Red', rgbHex: '#FF0000' },
    ];
    const grid = new Uint8Array([1, 0, 2, 0, 2, 0]);

    const buf = renderPatternPreviewPng({ width, height, palette, grid });
    const png = PNG.sync.read(buf);

    const blockSize = Math.max(1, Math.floor(512 / Math.max(width, height)));

    const expectedRgb: Record<number, { r: number; g: number; b: number }> = {
      1: { r: 0, g: 0, b: 0 },
      2: { r: 255, g: 0, b: 0 },
    };

    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const cellValue = grid[r * width + c];
        for (let by = 0; by < blockSize; by++) {
          for (let bx = 0; bx < blockSize; bx++) {
            const px = c * blockSize + bx;
            const py = r * blockSize + by;
            const idx = (png.width * py + px) * 4;

            if (cellValue === 0) {
              expect(png.data[idx]).toBe(0);
              expect(png.data[idx + 1]).toBe(0);
              expect(png.data[idx + 2]).toBe(0);
              expect(png.data[idx + 3]).toBe(0);
            } else {
              const expected = expectedRgb[cellValue];
              expect(png.data[idx]).toBe(expected.r);
              expect(png.data[idx + 1]).toBe(expected.g);
              expect(png.data[idx + 2]).toBe(expected.b);
              expect(png.data[idx + 3]).toBe(255);
            }
          }
        }
      }
    }
  });

  it('throws when grid.length does not match width * height', () => {
    expect(() =>
      renderPatternPreviewPng({
        width: 2,
        height: 2,
        palette: [{ dmcCode: '310', name: 'Black', rgbHex: '#000000' }],
        grid: new Uint8Array([1, 0, 1]),
      }),
    ).toThrow();
  });

  it('throws when width is 301', () => {
    expect(() =>
      renderPatternPreviewPng({
        width: 301,
        height: 2,
        palette: [{ dmcCode: '310', name: 'Black', rgbHex: '#000000' }],
        grid: new Uint8Array(301 * 2),
      }),
    ).toThrow();
  });
});
