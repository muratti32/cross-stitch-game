import { PNG } from 'pngjs';
import {
  renderPatternThumbnailPng,
  FABRIC_HEX,
  VARIANT_TUNING,
  PatternThumbnailVariant,
} from './pattern-thumbnail-renderer';

describe('Pattern Thumbnail Renderer', () => {
  const palette = [{ dmcCode: '310', name: 'Medium Dark Slate Gray', rgbHex: '#808080' }];

  function isFabricish(r: number, g: number, b: number, amp: number): boolean {
    return Math.abs(r - 237) <= amp && Math.abs(g - 230) <= amp && Math.abs(b - 214) <= amp;
  }

  it('has the correct fabric hex constant', () => {
    expect(FABRIC_HEX).toBe('#EDE6D6');
  });

  it('renders a square output for square and non-square grids in browsing variant', () => {
    // 1. Square grid
    const bufSquare = renderPatternThumbnailPng({
      width: 10,
      height: 10,
      palette,
      grid: new Uint8Array(100).fill(1),
      variant: 'browsing',
    });
    const pngSquare = PNG.sync.read(bufSquare);
    expect(pngSquare.width).toBe(512);
    expect(pngSquare.height).toBe(512);

    // 2. Extreme non-square grid (40x5)
    const bufRect = renderPatternThumbnailPng({
      width: 40,
      height: 5,
      palette,
      grid: new Uint8Array(200).fill(1),
      variant: 'browsing',
    });
    const pngRect = PNG.sync.read(bufRect);
    expect(pngRect.width).toBe(512);
    expect(pngRect.height).toBe(512);
  });

  it('centres a non-square design and surrounds it with fabric', () => {
    const width = 40;
    const height = 5;
    const size = 512;
    const tuning = VARIANT_TUNING.browsing;
    const amp = tuning.weaveAmplitude;

    const buf = renderPatternThumbnailPng({
      width,
      height,
      palette,
      grid: new Uint8Array(200).fill(1),
      variant: 'browsing',
    });
    const png = PNG.sync.read(buf);

    const cellPx = Math.floor(size / Math.max(width, height));
    const designWidth = width * cellPx;
    const designHeight = height * cellPx;
    const offsetX = Math.floor((size - designWidth) / 2);
    const offsetY = Math.floor((size - designHeight) / 2);

    // Corner pixels of the canvas must be fabric-ish
    const corners = [
      (png.width * 0 + 0) * 4,
      (png.width * 0 + (size - 1)) * 4,
      (png.width * (size - 1) + 0) * 4,
      (png.width * (size - 1) + (size - 1)) * 4,
    ];
    for (const idx of corners) {
      expect(isFabricish(png.data[idx], png.data[idx + 1], png.data[idx + 2], amp)).toBe(true);
    }

    // Pixels just outside the design rectangle (margin) must be fabric-ish
    if (offsetY > 0) {
      const idxAbove = (png.width * (offsetY - 1) + offsetX) * 4;
      expect(isFabricish(png.data[idxAbove], png.data[idxAbove + 1], png.data[idxAbove + 2], amp)).toBe(true);
    }
    if (offsetY + designHeight < size) {
      const idxBelow = (png.width * (offsetY + designHeight) + offsetX) * 4;
      expect(isFabricish(png.data[idxBelow], png.data[idxBelow + 1], png.data[idxBelow + 2], amp)).toBe(true);
    }

    // Inside the design rectangle, there must be stitched (non-fabric) pixels
    let hasStitch = false;
    for (let y = offsetY; y < offsetY + designHeight; y++) {
      for (let x = offsetX; x < offsetX + designWidth; x++) {
        const idx = (png.width * y + x) * 4;
        if (!isFabricish(png.data[idx], png.data[idx + 1], png.data[idx + 2], amp)) {
          hasStitch = true;
          break;
        }
      }
      if (hasStitch) break;
    }
    expect(hasStitch).toBe(true);
  });

  it('renders unstitched cells (value 0) as fabric ground', () => {
    const width = 2;
    const height = 2;
    const grid = new Uint8Array([1, 0, 0, 1]); // cells (0,1) and (1,0) are unstitched
    const size = 512;
    const tuning = VARIANT_TUNING.browsing;
    const amp = tuning.weaveAmplitude;

    const buf = renderPatternThumbnailPng({
      width,
      height,
      palette,
      grid,
      variant: 'browsing',
    });
    const png = PNG.sync.read(buf);

    const cellPx = Math.floor(size / Math.max(width, height)); // 256
    const offsetX = Math.floor((size - width * cellPx) / 2); // 0
    const offsetY = Math.floor((size - height * cellPx) / 2); // 0

    // Sample the center of cell (0, 1) which is at row 0, col 1
    // Pixels are from x = 256 to 511, y = 0 to 255
    const centerX = offsetX + 1 * cellPx + Math.floor(cellPx / 2);
    const centerY = offsetY + 0 * cellPx + Math.floor(cellPx / 2);

    const idx = (png.width * centerY + centerX) * 4;
    expect(isFabricish(png.data[idx], png.data[idx + 1], png.data[idx + 2], amp)).toBe(true);
  });

  it('shades a stitched cell in detail variant with lighter and darker colors in same hue direction', () => {
    const width = 2;
    const height = 2;
    const grid = new Uint8Array([1, 0, 0, 0]); // stitched cell at (0, 0)
    const size = 1536;

    const buf = renderPatternThumbnailPng({
      width,
      height,
      palette,
      grid,
      variant: 'detail',
    });
    const png = PNG.sync.read(buf);

    const cellPx = Math.floor(size / Math.max(width, height)); // 768
    const offsetX = Math.floor((size - width * cellPx) / 2); // 0
    const offsetY = Math.floor((size - height * cellPx) / 2); // 0

    const uniqueColors = new Set<string>();
    let lighterCount = 0;
    let darkerCount = 0;

    // Scan a central sub-window of the cell to avoid borders and check stitch details
    for (let y = offsetY + 200; y < offsetY + cellPx - 200; y++) {
      for (let x = offsetX + 200; x < offsetX + cellPx - 200; x++) {
        const idx = (png.width * y + x) * 4;
        const r = png.data[idx];
        const g = png.data[idx + 1];
        const b = png.data[idx + 2];

        // Filter out fabric pixels
        if (isFabricish(r, g, b, VARIANT_TUNING.detail.weaveAmplitude)) {
          continue;
        }

        const key = `${r},${g},${b}`;
        uniqueColors.add(key);

        // Base color is #808080 (128, 128, 128)
        // Shading band [0.70 * 128, 1.80 * 128] => [89, 230] (allows for minor fabric blending)
        expect(r).toBeGreaterThanOrEqual(89);
        expect(r).toBeLessThanOrEqual(230);
        expect(g).toBeGreaterThanOrEqual(89);
        expect(g).toBeLessThanOrEqual(230);
        expect(b).toBeGreaterThanOrEqual(89);
        expect(b).toBeLessThanOrEqual(230);

        if (r > 128) {
          lighterCount++;
        } else if (r < 128) {
          darkerCount++;
        }
      }
    }

    expect(uniqueColors.size).toBeGreaterThan(1);
    expect(lighterCount).toBeGreaterThan(0);
    expect(darkerCount).toBeGreaterThan(0);
  });

  it('differs in rendering treatment rather than simple scaling between browsing and detail variants', () => {
    const width = 10;
    const height = 10;
    const grid = new Uint8Array(100).fill(1);

    const bufBrowsing = renderPatternThumbnailPng({
      width,
      height,
      palette,
      grid,
      variant: 'browsing',
    });
    const bufDetail = renderPatternThumbnailPng({
      width,
      height,
      palette,
      grid,
      variant: 'detail',
    });

    // Byte lengths and dimensions should differ as expected
    expect(bufBrowsing.length).not.toBe(bufDetail.length);

    const pngBrowsing = PNG.sync.read(bufBrowsing);
    const pngDetail = PNG.sync.read(bufDetail);

    expect(pngBrowsing.width).toBe(512);
    expect(pngDetail.width).toBe(1536);

    // Browsing variant should cover more (lower fraction of exposed fabric) due to thicker glyphs
    const getFabricFraction = (png: PNG, size: number, amp: number): number => {
      const cellPx = Math.floor(size / Math.max(width, height));
      const designWidth = width * cellPx;
      const designHeight = height * cellPx;
      const offsetX = Math.floor((size - designWidth) / 2);
      const offsetY = Math.floor((size - designHeight) / 2);

      let fabricCount = 0;
      let totalCount = 0;

      for (let y = offsetY; y < offsetY + designHeight; y++) {
        for (let x = offsetX; x < offsetX + designWidth; x++) {
          const idx = (size * y + x) * 4;
          const r = png.data[idx];
          const g = png.data[idx + 1];
          const b = png.data[idx + 2];
          totalCount++;
          if (isFabricish(r, g, b, amp)) {
            fabricCount++;
          }
        }
      }
      return fabricCount / totalCount;
    };

    const browsingFraction = getFabricFraction(pngBrowsing, 512, VARIANT_TUNING.browsing.weaveAmplitude);
    const detailFraction = getFabricFraction(pngDetail, 1536, VARIANT_TUNING.detail.weaveAmplitude);

    // Thicker glyphs in browsing must cover more, so browsing fabric fraction should be smaller
    expect(browsingFraction).toBeLessThan(detailFraction);
  });

  it('produces byte-identical outputs across repeat calls', () => {
    const input = {
      width: 8,
      height: 8,
      palette,
      grid: new Uint8Array(64).fill(1),
    };

    const out1Browsing = renderPatternThumbnailPng({ ...input, variant: 'browsing' });
    const out2Browsing = renderPatternThumbnailPng({ ...input, variant: 'browsing' });
    expect(out1Browsing.equals(out2Browsing)).toBe(true);

    const out1Detail = renderPatternThumbnailPng({ ...input, variant: 'detail' });
    const out2Detail = renderPatternThumbnailPng({ ...input, variant: 'detail' });
    expect(out1Detail.equals(out2Detail)).toBe(true);
  });

  it('throws for invalid dimensions, grid length mismatch, and invalid variant', () => {
    const validGrid = new Uint8Array(4);

    expect(() =>
      renderPatternThumbnailPng({
        width: 301,
        height: 2,
        palette,
        grid: validGrid,
        variant: 'browsing',
      }),
    ).toThrow('Invalid dimensions: 301x2');

    expect(() =>
      renderPatternThumbnailPng({
        width: 2,
        height: 0,
        palette,
        grid: validGrid,
        variant: 'browsing',
      }),
    ).toThrow('Invalid dimensions: 2x0');

    expect(() =>
      renderPatternThumbnailPng({
        width: 2,
        height: 2,
        palette,
        grid: new Uint8Array(3),
        variant: 'browsing',
      }),
    ).toThrow('Grid length 3 does not match dimensions 2x2');

    expect(() =>
      renderPatternThumbnailPng({
        width: 2,
        height: 2,
        palette,
        grid: validGrid,
        variant: 'invalid_variant' as PatternThumbnailVariant,
      }),
    ).toThrow('Unknown variant: invalid_variant');
  });
});
