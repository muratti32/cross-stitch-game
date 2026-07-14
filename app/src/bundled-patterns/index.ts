import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
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
  if (!binaryAssets[id] || !previewAssets[id]) {
    throw new Error(`Assets missing for bundled pattern ID: ${id}`);
  }
  return {
    ...entry,
    difficulty: entry.difficulty as 'easy' | 'medium' | 'hard',
    previewAsset: previewAssets[id],
    binaryAsset: binaryAssets[id],
  };
});

/**
 * Pure JavaScript base64 decoder to bypass platform differences in atob/btoa.
 */
function decodeBase64(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }

  let len = base64.length;
  if (base64.endsWith('==')) {
    len -= 2;
  } else if (base64.endsWith('=')) {
    len -= 1;
  }

  const bytes = new Uint8Array((len * 3) / 4);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const charCode0 = base64.charCodeAt(i);
    const charCode1 = base64.charCodeAt(i + 1);
    const charCode2 = base64.charCodeAt(i + 2);
    const charCode3 = base64.charCodeAt(i + 3);

    const chunk =
      (lookup[charCode0] << 18) |
      (lookup[charCode1] << 12) |
      (lookup[charCode2] << 6) |
      lookup[charCode3];

    if (p < bytes.length) bytes[p++] = (chunk >> 16) & 255;
    if (p < bytes.length) bytes[p++] = (chunk >> 8) & 255;
    if (p < bytes.length) bytes[p++] = chunk & 255;
  }
  return bytes;
}

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

  const base64 = await FileSystem.readAsStringAsync(asset.localUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const bytes = decodeBase64(base64);

  // decodePatternArtifact performs SHA-256 validation before parsing
  return decodePatternArtifact(bytes, pattern.checksum);
}
