import type { ConversionProfile } from './entities';

export const MIN_FRAME_ASPECT = 1 / 6;
export const MAX_FRAME_ASPECT = 6;

const PROFILE_SETTINGS = {
  easy: { maxColors: 12, shortEdgeCells: 50 },
  standard: { maxColors: 20, shortEdgeCells: 100 },
  detailed: { maxColors: 30, shortEdgeCells: 150 },
} as const;

export interface ConversionSettings {
  height: number;
  maxColors: number;
  shortEdgeCells: number;
  width: number;
}

function roundRatioHalfUp(
  value: number,
  numerator: number,
  denominator: number,
): number {
  return Math.floor((value * numerator + denominator / 2) / denominator);
}

export function calculatePatternSize(
  sourceWidth: number,
  sourceHeight: number,
  shortEdgeCells: number,
): { width: number; height: number } {
  if (
    !Number.isSafeInteger(sourceWidth) ||
    !Number.isSafeInteger(sourceHeight) ||
    sourceWidth < 1 ||
    sourceHeight < 1
  ) {
    throw new RangeError('Framed artwork dimensions must be positive integers');
  }
  if (!Number.isSafeInteger(shortEdgeCells) || shortEdgeCells < 20 || shortEdgeCells > 300) {
    throw new RangeError('Short edge must be between 20 and 300 cells');
  }

  const aspect = sourceWidth / sourceHeight;
  if (aspect < MIN_FRAME_ASPECT || aspect > MAX_FRAME_ASPECT) {
    throw new RangeError('Artwork framing must stay between 1:6 and 6:1');
  }

  if (sourceWidth <= sourceHeight) {
    return {
      width: shortEdgeCells,
      height: roundRatioHalfUp(shortEdgeCells, sourceHeight, sourceWidth),
    };
  }
  return {
    width: roundRatioHalfUp(shortEdgeCells, sourceWidth, sourceHeight),
    height: shortEdgeCells,
  };
}

export function resolveConversionSettings(input: {
  customMaxColors?: number;
  customShortEdgeCells?: number;
  profile: ConversionProfile;
  sourceHeight: number;
  sourceWidth: number;
}): ConversionSettings {
  const preset =
    input.profile === 'custom' ? null : PROFILE_SETTINGS[input.profile];
  const shortEdgeCells = preset?.shortEdgeCells ?? input.customShortEdgeCells;
  const maxColors = preset?.maxColors ?? input.customMaxColors;

  if (
    shortEdgeCells === undefined ||
    !Number.isSafeInteger(shortEdgeCells) ||
    shortEdgeCells < 20 ||
    shortEdgeCells > 300
  ) {
    throw new RangeError('Custom short edge must be between 20 and 300 cells');
  }
  if (
    maxColors === undefined ||
    !Number.isSafeInteger(maxColors) ||
    maxColors < 5 ||
    maxColors > 60
  ) {
    throw new RangeError('Custom color limit must be between 5 and 60');
  }

  const size = calculatePatternSize(
    input.sourceWidth,
    input.sourceHeight,
    shortEdgeCells,
  );
  if (size.width > 300 || size.height > 300) {
    throw new RangeError(
      `${input.profile} is unavailable for this artwork framing`,
    );
  }
  return { ...size, maxColors, shortEdgeCells };
}
