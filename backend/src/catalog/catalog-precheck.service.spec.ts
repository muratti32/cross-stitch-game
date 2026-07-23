import { PNG } from 'pngjs';

import { perceptualHash } from './catalog-precheck.service';

describe('Catalog Precheck perceptual hash', () => {
  it('is stable for identical previews and changes when the visual structure changes', () => {
    const leftDark = makePreview((x) => x < 5);
    const rightDark = makePreview((x) => x >= 5);

    expect(perceptualHash(Buffer.from(leftDark))).toBe(perceptualHash(Buffer.from(leftDark)));
    expect(perceptualHash(Buffer.from(leftDark))).not.toBe(perceptualHash(Buffer.from(rightDark)));
    expect(perceptualHash(Buffer.from(leftDark))).toMatch(/^[0-9a-f]{16}$/);
  });

  it('rejects an oversized PNG from its header before pixel decoding', () => {
    const header = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header);
    header.writeUInt32BE(12_000, 16);
    header.writeUInt32BE(12_000, 20);

    expect(() => perceptualHash(header)).toThrow('Preview exceeds pixel limit');
  });
});

function makePreview(isDark: (x: number, y: number) => boolean): Buffer {
  const png = new PNG({ height: 8, width: 9 });
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const offset = (y * png.width + x) * 4;
      const value = isDark(x, y) ? 0 : 255;
      png.data[offset] = value;
      png.data[offset + 1] = value;
      png.data[offset + 2] = value;
      png.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}
