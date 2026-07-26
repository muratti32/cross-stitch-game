import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { decodePatternArtifact, PatternData } from '../pattern-artifact';
import manifestJson from '../../assets/bundled-patterns/manifest.json';

export interface BundledPattern {
  id: string;
  title: string;
  description: string;
  width: number;
  height: number;
  paletteSize: number;
  checksum: string;
  byteLength: number;
  schemaVersion: number;
  difficulty: 'easy' | 'medium' | 'hard';
  isPremium: boolean;
  colorsCount: number;
  cellsCount: number;
  createdAt: string;
  previewAsset: number;
  thumbnailAsset: number;
  binaryAsset: number;
}

const binaryAssets: Record<string, number> = {
  starter_heart: require('../../assets/bundled-patterns/starter_heart.bin'),
  starter_flower: require('../../assets/bundled-patterns/starter_flower.bin'),
  starter_star: require('../../assets/bundled-patterns/starter_star.bin'),
  starter_mushroom: require('../../assets/bundled-patterns/starter_mushroom.bin'),
};

const previewAssets: Record<string, number> = {
  starter_heart: require('../../assets/bundled-patterns/starter_heart.png'),
  starter_flower: require('../../assets/bundled-patterns/starter_flower.png'),
  starter_star: require('../../assets/bundled-patterns/starter_star.png'),
  starter_mushroom: require('../../assets/bundled-patterns/starter_mushroom.png'),
};

const thumbnailAssets: Record<string, number> = {
  starter_heart: require('../../assets/bundled-patterns/starter_heart_thumbnail.png'),
  starter_flower: require('../../assets/bundled-patterns/starter_flower_thumbnail.png'),
  starter_star: require('../../assets/bundled-patterns/starter_star_thumbnail.png'),
  starter_mushroom: require('../../assets/bundled-patterns/starter_mushroom_thumbnail.png'),
};

interface ManifestJsonEntry {
  id: string;
  title: string;
  description: string;
  width: number;
  height: number;
  paletteSize: number;
  checksum: string;
  byteLength: number;
  schemaVersion: number;
  difficulty: string;
  isPremium: boolean;
  colorsCount: number;
  cellsCount: number;
  createdAt: string;
}

export const BUNDLED_PATTERNS: BundledPattern[] = (manifestJson as ManifestJsonEntry[]).map((entry) => {
  const id = entry.id;
  if (!binaryAssets[id] || !previewAssets[id] || !thumbnailAssets[id]) {
    throw new Error(`Assets missing for bundled pattern ID: ${id}`);
  }
  return {
    ...entry,
    difficulty: entry.difficulty as 'easy' | 'medium' | 'hard',
    previewAsset: previewAssets[id],
    thumbnailAsset: thumbnailAssets[id],
    binaryAsset: binaryAssets[id],
  };
});

/**
 * Loads a bundled pattern, downloads it via the Expo asset system,
 * reads its binary bytes, verifies its SHA-256 checksum,
 * and decodes it.
 */
export async function loadBundledPattern(id: string): Promise<PatternData> {
  const pattern = BUNDLED_PATTERNS.find((p) => p.id === id);
  if (!pattern) {
    throw new Error(`Pattern with ID ${id} not found in bundled patterns.`);
  }

  const asset = Asset.fromModule(pattern.binaryAsset);
  await asset.downloadAsync();

  if (!asset.localUri) {
    throw new Error(`Local URI is missing for downloaded asset of pattern ${id}`);
  }

  const bytes = await new File(asset.localUri).bytes();

  // decodePatternArtifact performs SHA-256 validation before parsing
  return decodePatternArtifact(bytes, pattern.checksum);
}
