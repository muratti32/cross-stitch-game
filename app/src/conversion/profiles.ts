export type ConversionProfile = 'easy' | 'standard' | 'detailed' | 'custom';

export interface ConversionSettings {
  height: number;
  maxColors: number;
  shortEdgeCells: number;
  width: number;
}

export const PROFILE_OPTIONS: ReadonlyArray<{
  id: Exclude<ConversionProfile, 'custom'>;
  label: string;
  maxColors: number;
  shortEdgeCells: number;
}> = [
  { id: 'easy', label: 'Easy', maxColors: 12, shortEdgeCells: 50 },
  { id: 'standard', label: 'Standard', maxColors: 20, shortEdgeCells: 100 },
  { id: 'detailed', label: 'Detailed', maxColors: 30, shortEdgeCells: 150 },
];

export function calculatePatternSize(
  sourceWidth: number,
  sourceHeight: number,
  shortEdgeCells: number,
): { width: number; height: number } {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    shortEdgeCells < 20 ||
    shortEdgeCells > 300
  ) {
    throw new RangeError('Invalid conversion dimensions');
  }
  const aspect = sourceWidth / sourceHeight;
  if (aspect < 1 / 6 || aspect > 6) {
    throw new RangeError('Artwork framing must stay between 1:6 and 6:1');
  }
  if (sourceWidth <= sourceHeight) {
    return {
      height: Math.floor((shortEdgeCells * sourceHeight) / sourceWidth + 0.5),
      width: shortEdgeCells,
    };
  }
  return {
    height: shortEdgeCells,
    width: Math.floor((shortEdgeCells * sourceWidth) / sourceHeight + 0.5),
  };
}

export function resolveSettings(input: {
  customMaxColors: number;
  customShortEdgeCells: number;
  profile: ConversionProfile;
  sourceHeight: number;
  sourceWidth: number;
}): ConversionSettings | null {
  const preset = PROFILE_OPTIONS.find((option) => option.id === input.profile);
  const shortEdgeCells = preset?.shortEdgeCells ?? input.customShortEdgeCells;
  const maxColors = preset?.maxColors ?? input.customMaxColors;
  if (
    shortEdgeCells < 20 ||
    shortEdgeCells > 300 ||
    maxColors < 5 ||
    maxColors > 60
  ) {
    return null;
  }
  try {
    const size = calculatePatternSize(
      input.sourceWidth,
      input.sourceHeight,
      shortEdgeCells,
    );
    return size.width <= 300 && size.height <= 300
      ? { ...size, maxColors, shortEdgeCells }
      : null;
  } catch {
    return null;
  }
}
