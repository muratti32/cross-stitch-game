import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { PNG } from 'pngjs';
import { DataSource } from 'typeorm';

import { ApiAppModule } from '../src/app.api.module';
import { CatalogService } from '../src/catalog/catalog.service';
import { encodePatternArtifactV1 } from '../src/catalog/pattern-artifact-encoder';
import { LocalObjectStorage } from '../src/catalog/storage/local-object-storage';
import { StaffPickEntity } from '../src/catalog/entities/staff-pick.entity';


interface SeedPattern {
  slug: string;
  title: string;
  creatorName: string;
  categoryCode: string;
  width: number;
  height: number;
  palette: { dmcCode: string; name: string; rgbHex: string }[];
  tagCodes: string[];
  unlockPriceTier: 'small' | 'medium' | null;
}

const SEED_PATTERNS: SeedPattern[] = [
  {
    slug: 'dinosaur-motif',
    title: 'Dinosaur Motif',
    creatorName: 'Stitch Wish Team',
    categoryCode: 'animals',
    width: 32,
    height: 32,
    palette: [
      { dmcCode: '310', name: 'Black', rgbHex: '#000000' },
      { dmcCode: '700', name: 'Green', rgbHex: '#008000' },
      { dmcCode: 'white', name: 'White', rgbHex: '#FFFFFF' },
    ],
    tagCodes: ['retro', 'dinosaur', 'kid'],
    unlockPriceTier: null,
  },
  {
    slug: 'cherry-blossom',
    title: 'Cherry Blossom',
    creatorName: 'Stitch Wish Team',
    categoryCode: 'nature-flowers',
    width: 24,
    height: 24,
    palette: [
      { dmcCode: '603', name: 'Pink', rgbHex: '#FF69B4' },
      { dmcCode: 'white', name: 'White', rgbHex: '#FFFFFF' },
      { dmcCode: '434', name: 'Brown', rgbHex: '#8B4513' },
    ],
    tagCodes: ['flower', 'spring', 'cute'],
    unlockPriceTier: null,
  },
  {
    slug: 'silly-cat-face',
    title: 'Silly Cat Face',
    creatorName: 'Pixel Artist',
    categoryCode: 'animals',
    width: 32,
    height: 32,
    palette: [
      { dmcCode: '310', name: 'Black', rgbHex: '#000000' },
      { dmcCode: '741', name: 'Tangerine', rgbHex: '#FF8C00' },
      { dmcCode: 'white', name: 'White', rgbHex: '#FFFFFF' },
    ],
    tagCodes: ['cat', 'funny', 'cute'],
    unlockPriceTier: null,
  },
  {
    slug: 'cozy-coffee-cup',
    title: 'Cozy Coffee Cup',
    creatorName: 'Pixel Artist',
    categoryCode: 'food-drink',
    width: 24,
    height: 24,
    palette: [
      { dmcCode: '434', name: 'Brown', rgbHex: '#8B4513' },
      { dmcCode: 'white', name: 'White', rgbHex: '#FFFFFF' },
      { dmcCode: '796', name: 'Dark Blue', rgbHex: '#000080' },
    ],
    tagCodes: ['coffee', 'warm', 'cozy'],
    unlockPriceTier: null,
  },
  {
    slug: 'tiny-red-heart',
    title: 'Tiny Red Heart',
    creatorName: 'Stitch Wish Team',
    categoryCode: 'words-symbols',
    width: 24,
    height: 24,
    palette: [
      { dmcCode: '666', name: 'Bright Red', rgbHex: '#E00000' },
      { dmcCode: '310', name: 'Black', rgbHex: '#000000' },
    ],
    tagCodes: ['love', 'heart', 'cute'],
    unlockPriceTier: 'small',
  },
  {
    slug: 'autumn-leaf',
    title: 'Autumn Leaf',
    creatorName: 'Retro Crafter',
    categoryCode: 'holidays-seasons',
    width: 32,
    height: 32,
    palette: [
      { dmcCode: '741', name: 'Tangerine', rgbHex: '#FF8C00' },
      { dmcCode: '434', name: 'Brown', rgbHex: '#8B4513' },
      { dmcCode: '816', name: 'Coral Red', rgbHex: '#B22222' },
    ],
    tagCodes: ['autumn', 'leaf', 'orange'],
    unlockPriceTier: 'medium',
  },
  {
    slug: 'mystic-star',
    title: 'Mystic Star',
    creatorName: 'Retro Crafter',
    categoryCode: 'fantasy',
    width: 32,
    height: 32,
    palette: [
      { dmcCode: '917', name: 'Plum', rgbHex: '#8B008B' },
      { dmcCode: '973', name: 'Bright Yellow', rgbHex: '#FFD700' },
      { dmcCode: 'white', name: 'White', rgbHex: '#FFFFFF' },
    ],
    tagCodes: ['star', 'magic', 'purple'],
    unlockPriceTier: null,
  },
  {
    slug: 'classic-checkerboard',
    title: 'Classic Checkerboard',
    creatorName: 'Vintage Stitcher',
    categoryCode: 'geometric-abstract',
    width: 24,
    height: 24,
    palette: [
      { dmcCode: '310', name: 'Black', rgbHex: '#000000' },
      { dmcCode: 'white', name: 'White', rgbHex: '#FFFFFF' },
    ],
    tagCodes: ['pattern', 'retro'],
    unlockPriceTier: null,
  },
  {
    slug: 'peace-sign',
    title: 'Peace Sign',
    creatorName: 'Vintage Stitcher',
    categoryCode: 'words-symbols',
    width: 24,
    height: 24,
    palette: [
      { dmcCode: '796', name: 'Dark Blue', rgbHex: '#000080' },
      { dmcCode: '973', name: 'Bright Yellow', rgbHex: '#FFD700' },
    ],
    tagCodes: ['peace', 'retro', 'symbol'],
    unlockPriceTier: null,
  },
  {
    slug: 'green-cactus',
    title: 'Green Cactus',
    creatorName: 'Pixel Artist',
    categoryCode: 'nature-flowers',
    width: 32,
    height: 32,
    palette: [
      { dmcCode: '700', name: 'Green', rgbHex: '#008000' },
      { dmcCode: '434', name: 'Brown', rgbHex: '#8B4513' },
      { dmcCode: '973', name: 'Bright Yellow', rgbHex: '#FFD700' },
    ],
    tagCodes: ['desert', 'plant', 'cute'],
    unlockPriceTier: null,
  },
  {
    slug: 'pixel-pizza',
    title: 'Pixel Pizza',
    creatorName: 'Pixel Artist',
    categoryCode: 'food-drink',
    width: 32,
    height: 32,
    palette: [
      { dmcCode: '973', name: 'Bright Yellow', rgbHex: '#FFD700' },
      { dmcCode: '666', name: 'Bright Red', rgbHex: '#E00000' },
      { dmcCode: '434', name: 'Brown', rgbHex: '#8B4513' },
    ],
    tagCodes: ['food', 'pizza', 'yummy'],
    unlockPriceTier: null,
  },
  {
    slug: 'tiny-castle',
    title: 'Tiny Castle',
    creatorName: 'Retro Crafter',
    categoryCode: 'places-architecture',
    width: 40,
    height: 40,
    palette: [
      { dmcCode: '310', name: 'Black', rgbHex: '#000000' },
      { dmcCode: 'white', name: 'White', rgbHex: '#FFFFFF' },
      { dmcCode: '973', name: 'Bright Yellow', rgbHex: '#FFD700' },
    ],
    tagCodes: ['castle', 'fantasy', 'stone'],
    unlockPriceTier: null,
  },
];

const TAG_LABELS: Record<string, string> = {
  retro: 'Retro',
  dinosaur: 'Dinosaur',
  kid: 'Kids',
  flower: 'Flower',
  spring: 'Spring',
  cute: 'Cute',
  cat: 'Cat',
  funny: 'Funny',
  coffee: 'Coffee',
  warm: 'Warm',
  cozy: 'Cozy',
  love: 'Love',
  heart: 'Heart',
  autumn: 'Autumn',
  leaf: 'Leaf',
  orange: 'Orange',
  star: 'Star',
  magic: 'Magic',
  purple: 'Purple',
  pattern: 'Pattern',
  peace: 'Peace',
  symbol: 'Symbol',
  desert: 'Desert',
  plant: 'Plant',
  food: 'Food',
  pizza: 'Pizza',
  yummy: 'Yummy',
  castle: 'Castle',
  stone: 'Stone',
};

const STAFF_PICKS = [
  { title: 'Tiny Red Heart', creator: 'Stitch Wish Team', position: 1 },
  { title: 'Dinosaur Motif', creator: 'Stitch Wish Team', position: 2 },
  { title: 'Silly Cat Face', creator: 'Pixel Artist', position: 3 },
  { title: 'Cozy Coffee Cup', creator: 'Pixel Artist', position: 4 },
  { title: 'Cherry Blossom', creator: 'Stitch Wish Team', position: 5 },
  { title: 'Autumn Leaf', creator: 'Retro Crafter', position: 6 },
];

function generateGrid(width: number, height: number, paletteSize: number, patternName: string): Uint8Array {
  const grid = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - width / 2;
      const dy = y - height / 2;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let value = 0;

      if (patternName.includes('Heart')) {
        const nx = (x - width / 2) / (width * 0.4);
        const ny = -(y - height / 2) / (height * 0.4);
        const inside = Math.pow(nx * nx + ny * ny - 1, 3) - nx * nx * Math.pow(ny, 3) < 0;
        value = inside ? (Math.abs(dx) < 2 ? 1 : 2) : 0;
      } else if (patternName.includes('Star')) {
        const angle = Math.atan2(dy, dx);
        const r = (width * 0.35) * (0.7 + 0.3 * Math.cos(angle * 5));
        value = dist < r ? 1 : 0;
      } else if (patternName.includes('Checkerboard')) {
        value = ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0) ? 1 : 2;
      } else if (patternName.includes('Cactus')) {
        const onTrunk = Math.abs(dx) < width * 0.15 && y > height * 0.2 && y < height * 0.9;
        const onArmL = x < width * 0.5 && x > width * 0.25 && y > height * 0.4 && y < height * 0.6;
        const onArmR = x > width * 0.5 && x < width * 0.75 && y > height * 0.3 && y < height * 0.5;
        value = (onTrunk || onArmL || onArmR) ? 1 : 0;
      } else {
        const maxR = width * 0.4;
        if (dist < maxR) {
          const part = Math.floor((dist / maxR) * paletteSize);
          value = Math.max(1, Math.min(paletteSize, part + 1));
        }
      }
      grid[y * width + x] = value;
    }
  }
  return grid;
}

function generatePreviewPng(width: number, height: number, palette: { rgbHex: string }[], grid: Uint8Array): Buffer {
  const upscale = 8;
  const pngWidth = width * upscale;
  const pngHeight = height * upscale;
  const png = new PNG({ width: pngWidth, height: pngHeight });

  const rgbPalette = palette.map((entry) => {
    const hex = entry.rgbHex.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return { r, g, b };
  });

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = grid[y * width + x];
      let r = 255, g = 255, b = 255, a = 0;
      if (cell > 0 && cell <= rgbPalette.length) {
        const color = rgbPalette[cell - 1];
        r = color.r;
        g = color.g;
        b = color.b;
        a = 255;
      }

      for (let dy = 0; dy < upscale; dy++) {
        for (let dx = 0; dx < upscale; dx++) {
          const px = (x * upscale + dx);
          const py = (y * upscale + dy);
          const idx = (pngWidth * py + px) * 4;
          png.data[idx] = r;
          png.data[idx + 1] = g;
          png.data[idx + 2] = b;
          png.data[idx + 3] = a;
        }
      }
    }
  }

  return PNG.sync.write(png);
}

async function run() {
  const app = await NestFactory.createApplicationContext(ApiAppModule);
  const catalogService = app.get(CatalogService);
  const storage = app.get(LocalObjectStorage);
  const dataSource = app.get(DataSource);

  try {
    console.log('Seeding tags and tag labels...');
    for (const [tagCode, label] of Object.entries(TAG_LABELS)) {
      await catalogService.upsertTagLabels(tagCode, [{ locale: 'en', label }]);
    }

    console.log('Seeding patterns...');
    for (const item of SEED_PATTERNS) {
      const grid = generateGrid(item.width, item.height, item.palette.length, item.title);

      const encoded = encodePatternArtifactV1({
        width: item.width,
        height: item.height,
        palette: item.palette,
        grid,
      });

      const artifactKey = `patterns/${item.slug}/artifact.bin`;
      const previewKey = `patterns/${item.slug}/preview.png`;

      await storage.put(artifactKey, encoded.bytes);

      const previewPng = generatePreviewPng(item.width, item.height, item.palette, grid);
      await storage.put(previewKey, previewPng);

      // Register the catalog artifact in object_registry
      await dataSource.query(
        `INSERT INTO "storage"."object_registry" ("object_key", "checksum", "byte_length", "state", "missing")
         VALUES ($1, $2, $3, 'available', false)
         ON CONFLICT ("object_key") DO UPDATE SET "checksum" = EXCLUDED."checksum", "byte_length" = EXCLUDED."byte_length", "state" = 'available', "missing" = false`,
        [artifactKey, encoded.checksum, encoded.byteLength],
      );

      // Deterministic fixed date for catalog ordering testing
      const publishedAt = new Date(Date.UTC(2026, 6, 14, 10, 0, SEED_PATTERNS.indexOf(item)));

      await catalogService.upsertPattern({
        title: item.title,
        creatorName: item.creatorName,
        categoryCode: item.categoryCode,
        width: item.width,
        height: item.height,
        paletteSize: item.palette.length,
        artifactObjectKey: artifactKey,
        artifactChecksum: encoded.checksum,
        artifactByteLength: encoded.byteLength,
        artifactSchemaVersion: encoded.schemaVersion,
        previewObjectKey: previewKey,
        unlockPriceTier: item.unlockPriceTier,
        status: 'available',
        publishedAt,
        tagCodes: item.tagCodes,
      });
    }

    console.log('Seeding staff picks...');
    const staffPickRepo = dataSource.getRepository(StaffPickEntity);
    await staffPickRepo.createQueryBuilder().delete().execute(); // Clear existing staff picks first to make it idempotent

    for (const pick of STAFF_PICKS) {
      await catalogService.setStaffPick(pick.title, pick.creator, pick.position);
    }

    console.log('Database seeded successfully.');
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

run().catch((error) => {
  console.error('Unhandled seed error:', error);
  process.exit(1);
});
