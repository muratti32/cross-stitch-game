import { PNG } from 'pngjs';

export type PatternThumbnailVariant = 'browsing' | 'detail';

export const PATTERN_THUMBNAIL_RENDERER_VERSION = 1;

export const PATTERN_THUMBNAIL_VARIANT_SIZE_PX: Readonly<
  Record<PatternThumbnailVariant, number>
> = { browsing: 512, detail: 1536 };

export const FABRIC_HEX = '#EDE6D6';

interface VariantTuning {
  size: number;
  armThicknessFraction: number;
  shadingStrength: number;
  weaveAmplitude: number;
  shadeBands: number;
  weavePeriodPx: number;
}

export const VARIANT_TUNING: Readonly<Record<PatternThumbnailVariant, VariantTuning>> = {
  browsing: {
    size: 512,
    armThicknessFraction: 0.23,
    shadingStrength: 0.45,
    weaveAmplitude: 3,
    shadeBands: 3,
    weavePeriodPx: 3,
  },
  detail: {
    size: 1536,
    armThicknessFraction: 0.17,
    shadingStrength: 1.0,
    weaveAmplitude: 6,
    shadeBands: 5,
    weavePeriodPx: 4,
  },
};

function getDistToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const ux = px - ax;
  const uy = py - ay;
  const len2 = vx * vx + vy * vy;
  let t = 0;
  if (len2 > 0) {
    t = (ux * vx + uy * vy) / len2;
    if (t < 0) {
      t = 0;
    } else if (t > 1) {
      t = 1;
    }
  }
  const cx = ax + t * vx;
  const cy = ay + t * vy;
  const dx = px - cx;
  const dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

export function renderPatternThumbnailPng(input: {
  width: number;
  height: number;
  palette: { dmcCode: string; name: string; rgbHex: string }[];
  grid: Uint8Array;
  variant: PatternThumbnailVariant;
}): Buffer {
  if (input.width < 1 || input.width > 300 || input.height < 1 || input.height > 300) {
    throw new Error(`Invalid dimensions: ${input.width}x${input.height}`);
  }
  if (input.grid.length !== input.width * input.height) {
    throw new Error(
      `Grid length ${input.grid.length} does not match dimensions ${input.width}x${input.height}`,
    );
  }
  if (input.variant !== 'browsing' && input.variant !== 'detail') {
    throw new Error(`Unknown variant: ${input.variant as string}`);
  }

  const tuning = VARIANT_TUNING[input.variant];
  const size = tuning.size;

  const integerCell = Math.floor(size / Math.max(input.width, input.height));
  const useGlyphs = integerCell >= 3;

  const png = new PNG({ width: size, height: size });

  // 1. Fabric ground base color (#EDE6D6) and weave modulation
  const baseR = 237; // 0xED
  const baseG = 230; // 0xE6
  const baseB = 214; // 0xD6

  const period = tuning.weavePeriodPx;
  const amp = tuning.weaveAmplitude;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const modX = x % period;
      const modY = y % period;
      const delta = (modX === 0 ? amp : 0) + (modY === 0 ? -amp : 0);

      const idx = (size * y + x) * 4;
      png.data[idx] = Math.max(0, Math.min(255, baseR + delta));
      png.data[idx + 1] = Math.max(0, Math.min(255, baseG + delta));
      png.data[idx + 2] = Math.max(0, Math.min(255, baseB + delta));
      png.data[idx + 3] = 255;
    }
  }

  // 2. Precompute procedural alpha mask if useGlyphs === true
  let maskCoverage: Float32Array | null = null;
  let maskShade: Float32Array | null = null;

  if (useGlyphs) {
    maskCoverage = new Float32Array(integerCell * integerCell);
    maskShade = new Float32Array(integerCell * integerCell);

    const inset = Math.max(1, integerCell * 0.06);
    const halfThickness = integerCell * tuning.armThicknessFraction;

    const k = tuning.shadingStrength;
    const B = tuning.shadeBands;
    const aaWidth = Math.max(1, integerCell * 0.06);

    // Line segments
    // \ arm (bottom layer, darker)
    const ax1 = inset;
    const ay1 = inset;
    const bx1 = integerCell - inset;
    const by1 = integerCell - inset;

    // / arm (top layer, lighter)
    const ax2 = inset;
    const ay2 = integerCell - inset;
    const bx2 = integerCell - inset;
    const by2 = inset;

    for (let by = 0; by < integerCell; by++) {
      for (let bx = 0; bx < integerCell; bx++) {
        const px = bx + 0.5;
        const py = by + 0.5;

        const d1 = getDistToSegment(px, py, ax1, ay1, bx1, by1);
        const d2 = getDistToSegment(px, py, ax2, ay2, bx2, by2);

        const idx = by * integerCell + bx;

        if (d2 < halfThickness) {
          // Top arm wins
          let coverage = 0;
          if (d2 < halfThickness - aaWidth) {
            coverage = 1.0;
          } else {
            coverage = 1.0 - (d2 - (halfThickness - aaWidth)) / aaWidth;
          }
          coverage = Math.max(0, Math.min(1, coverage));

          const normDist = d2 / halfThickness;
          const band = Math.min(B - 1, Math.floor(normDist * B));
          const q = (band + 0.5) / B;
          const fullShade = 1.02 + 0.20 * (1 - q * q);
          const shade = 1.0 + (fullShade - 1.0) * k;

          maskCoverage[idx] = coverage;
          maskShade[idx] = shade;
        } else if (d1 < halfThickness) {
          // Bottom arm
          let coverage = 0;
          if (d1 < halfThickness - aaWidth) {
            coverage = 1.0;
          } else {
            coverage = 1.0 - (d1 - (halfThickness - aaWidth)) / aaWidth;
          }
          coverage = Math.max(0, Math.min(1, coverage));

          const normDist = d1 / halfThickness;
          const band = Math.min(B - 1, Math.floor(normDist * B));
          const q = (band + 0.5) / B;
          const fullShade = 0.72 + 0.18 * (1 - q * q);
          const shade = 1.0 + (fullShade - 1.0) * k;

          maskCoverage[idx] = coverage;
          maskShade[idx] = shade;
        } else {
          maskCoverage[idx] = 0;
          maskShade[idx] = 1.0;
        }
      }
    }
  }

  // 3. Render stitched cells
  if (useGlyphs) {
    const designWidth = input.width * integerCell;
    const designHeight = input.height * integerCell;
    const offsetX = Math.floor((size - designWidth) / 2);
    const offsetY = Math.floor((size - designHeight) / 2);

    for (let r = 0; r < input.height; r++) {
      for (let c = 0; c < input.width; c++) {
        const gridIndex = r * input.width + c;
        const cellValue = input.grid[gridIndex];
        if (cellValue === 0) {
          continue;
        }
        const paletteEntry = input.palette[cellValue - 1];
        if (!paletteEntry) {
          continue;
        }
        const hex = paletteEntry.rgbHex;
        const dmcR = parseInt(hex.substring(1, 3), 16);
        const dmcG = parseInt(hex.substring(3, 5), 16);
        const dmcB = parseInt(hex.substring(5, 7), 16);

        const cellStartX = offsetX + c * integerCell;
        const cellStartY = offsetY + r * integerCell;

        if (maskCoverage && maskShade) {
          // Draw the precomputed mask
          for (let by = 0; by < integerCell; by++) {
            const py = cellStartY + by;
            if (py < 0 || py >= size) {
              continue;
            }
            for (let bx = 0; bx < integerCell; bx++) {
              const px = cellStartX + bx;
              if (px < 0 || px >= size) {
                continue;
              }
              const maskIdx = by * integerCell + bx;
              const coverage = maskCoverage[maskIdx];
              if (coverage <= 0) {
                continue;
              }
              const shade = maskShade[maskIdx];
              const idx = (size * py + px) * 4;

              const cellR = Math.max(0, Math.min(255, Math.round(dmcR * shade)));
              const cellG = Math.max(0, Math.min(255, Math.round(dmcG * shade)));
              const cellB = Math.max(0, Math.min(255, Math.round(dmcB * shade)));

              if (coverage >= 1.0) {
                png.data[idx] = cellR;
                png.data[idx + 1] = cellG;
                png.data[idx + 2] = cellB;
              } else {
                const fabricR = png.data[idx];
                const fabricG = png.data[idx + 1];
                const fabricB = png.data[idx + 2];

                png.data[idx] = Math.max(0, Math.min(255, Math.round(cellR * coverage + fabricR * (1 - coverage))));
                png.data[idx + 1] = Math.max(0, Math.min(255, Math.round(cellG * coverage + fabricG * (1 - coverage))));
                png.data[idx + 2] = Math.max(0, Math.min(255, Math.round(cellB * coverage + fabricB * (1 - coverage))));
              }
            }
          }
        }
      }
    }
  } else {
    // Flat mode
    const cellSpan = size / Math.max(input.width, input.height);
    const designWidth = Math.round(input.width * cellSpan);
    const designHeight = Math.round(input.height * cellSpan);
    const offsetX = Math.floor((size - designWidth) / 2);
    const offsetY = Math.floor((size - designHeight) / 2);

    for (let r = 0; r < input.height; r++) {
      for (let c = 0; c < input.width; c++) {
        const gridIndex = r * input.width + c;
        const cellValue = input.grid[gridIndex];
        if (cellValue === 0) {
          continue;
        }
        const paletteEntry = input.palette[cellValue - 1];
        if (!paletteEntry) {
          continue;
        }
        const hex = paletteEntry.rgbHex;
        const dmcR = parseInt(hex.substring(1, 3), 16);
        const dmcG = parseInt(hex.substring(3, 5), 16);
        const dmcB = parseInt(hex.substring(5, 7), 16);

        const cellStartX = offsetX + Math.round(c * cellSpan);
        const cellEndX = offsetX + Math.round((c + 1) * cellSpan);

        const cellStartY = offsetY + Math.round(r * cellSpan);
        const cellEndY = offsetY + Math.round((r + 1) * cellSpan);

        const startX = Math.max(0, Math.min(size - 1, cellStartX));
        const endX = Math.max(0, Math.min(size, cellEndX));
        const startY = Math.max(0, Math.min(size - 1, cellStartY));
        const endY = Math.max(0, Math.min(size, cellEndY));

        for (let py = startY; py < endY; py++) {
          for (let px = startX; px < endX; px++) {
            const idx = (size * py + px) * 4;
            png.data[idx] = dmcR;
            png.data[idx + 1] = dmcG;
            png.data[idx + 2] = dmcB;
          }
        }
      }
    }
  }

  return PNG.sync.write(png, { deflateLevel: 9 });
}
