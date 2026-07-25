import { type PatternData, type PaletteEntry } from "../pattern-artifact";
import { STITCH_INTERACTION_BUDGET } from "./budgets";

/**
 * ADR-0031: Performance fixtures for release gate evaluations.
 * Provides deterministic pattern and completed-mask generation.
 */

/**
 * Deterministic PRNG using the mulberry32 algorithm.
 * @param a Seed value.
 */
function mulberry32(a: number) {
  return function (): number {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Converts HSL color values to a hex RGB string (e.g. "#FF0000").
 */
function hslToHex(h: number, s: number, l: number): string {
  const sFraction = s / 100;
  const lFraction = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sFraction * Math.min(lFraction, 1 - lFraction);
  const f = (n: number) => {
    const kVal = k(n);
    const color = lFraction - a * Math.max(Math.min(kVal - 3, 9 - kVal, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

/**
 * Generates a deterministic palette of a specific size.
 * @param size Number of DMC palette entries to generate.
 */
export function buildBudgetPalette(size: number): PaletteEntry[] {
  const palette: PaletteEntry[] = [];
  for (let i = 0; i < size; i++) {
    const dmcCode = `${200 + i}`;
    const name = `DMC ${dmcCode} Color`;
    // Spread hues nicely using the golden angle approximation
    const h = (i * 137.5) % 360;
    const s = 60 + (i % 3) * 10;
    const l = 40 + (i % 3) * 10;
    const rgbHex = hslToHex(h, s, l);
    palette.push({ dmcCode, name, rgbHex });
  }
  return palette;
}

/**
 * Generates a deterministic PatternData fixture filled with clustered color regions.
 */
export function buildBudgetPattern(options?: {
  width?: number;
  height?: number;
  paletteSize?: number;
  seed?: number;
}): PatternData {
  const width = options?.width ?? STITCH_INTERACTION_BUDGET.fixture.width;
  const height = options?.height ?? STITCH_INTERACTION_BUDGET.fixture.height;
  const paletteSize = options?.paletteSize ?? STITCH_INTERACTION_BUDGET.fixture.paletteSize;
  const seed = options?.seed ?? 42;

  const palette = buildBudgetPalette(paletteSize);
  const grid = new Uint8Array(width * height);

  const nextRand = mulberry32(seed);

  // Seed Voronoi centers for clustered color blocks
  const numCenters = Math.max(10, Math.min(100, Math.floor((width * height) / 900)));
  const centers: { x: number; y: number; colorIndex: number }[] = [];

  for (let i = 0; i < numCenters; i++) {
    const rx = Math.floor(nextRand() * width);
    const ry = Math.floor(nextRand() * height);
    const colorIndex = Math.floor(nextRand() * paletteSize) + 1; // 1-based palette index
    centers.push({ x: rx, y: ry, colorIndex });
  }

  // Set each pixel to the color of the closest Voronoi center
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let minDist = Infinity;
      let bestColor = 1;
      for (let i = 0; i < centers.length; i++) {
        const center = centers[i];
        const dist = Math.abs(x - center.x) + Math.abs(y - center.y);
        if (dist < minDist) {
          minDist = dist;
          bestColor = center.colorIndex;
        }
      }
      grid[y * width + x] = bestColor;
    }
  }

  return {
    schemaVersion: 1,
    width,
    height,
    palette,
    grid,
  };
}

/**
 * Generates a completed-cell mask of identical dimension.
 * Guaranteed to contain exactly `round(cells * completedRatio)` completed cells (1).
 */
export function buildCompletedMask(
  pattern: PatternData,
  completedRatio: number,
  seed?: number
): Uint8Array {
  const cells = pattern.width * pattern.height;
  const targetCompleted = Math.round(cells * completedRatio);
  const mask = new Uint8Array(cells);

  const nextRand = mulberry32(seed ?? 101);

  // Populate cell index list
  const indices = new Int32Array(cells);
  for (let i = 0; i < cells; i++) {
    indices[i] = i;
  }

  // Shuffle only up to the target index to be efficient
  for (let i = 0; i < targetCompleted; i++) {
    const swapWith = i + Math.floor(nextRand() * (cells - i));
    const temp = indices[i];
    indices[i] = indices[swapWith];
    indices[swapWith] = temp;
  }

  // Mark the selected cells as completed
  for (let i = 0; i < targetCompleted; i++) {
    mask[indices[i]] = 1;
  }

  return mask;
}

/**
 * Builds a deterministic late-play fixture where 85% of cells are completed.
 */
export function buildLatePlayFixture(seed?: number): {
  pattern: PatternData;
  completed: Uint8Array;
} {
  const pattern = buildBudgetPattern({ seed });
  const completed = buildCompletedMask(
    pattern,
    STITCH_INTERACTION_BUDGET.fixture.latePlayCompletedRatio,
    seed !== undefined ? seed + 1 : undefined
  );
  return { pattern, completed };
}

/**
 * Builds a deterministic fully completed fixture where 100% of cells are completed.
 */
export function buildFullyCompletedFixture(seed?: number): {
  pattern: PatternData;
  completed: Uint8Array;
} {
  const pattern = buildBudgetPattern({ seed });
  const completed = buildCompletedMask(pattern, 1.0, seed !== undefined ? seed + 1 : undefined);
  return { pattern, completed };
}
