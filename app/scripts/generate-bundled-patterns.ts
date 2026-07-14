import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import { sha256 } from 'js-sha256';
import { encodePatternArtifact, PatternData, PaletteEntry } from '../src/pattern-artifact';

// Helper to convert grid string templates to Uint8Array
function createGrid(template: string, width: number, height: number): Uint8Array {
  const clean = template.replace(/\s+/g, '');
  if (clean.length !== width * height) {
    throw new Error(`Grid template length (${clean.length}) does not match width * height (${width * height})`);
  }
  const grid = new Uint8Array(width * height);
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (char === '.' || char === ' ') {
      grid[i] = 0;
    } else {
      const val = parseInt(char, 10);
      if (isNaN(val)) {
        throw new Error(`Invalid character in grid template: ${char}`);
      }
      grid[i] = val;
    }
  }
  return grid;
}

// 1. Cozy Heart (20x20)
const heartPalette: PaletteEntry[] = [
  { dmcCode: '321', name: 'Christmas Red', rgbHex: '#C51E3A' }, // Red (1)
  { dmcCode: '666', name: 'Bright Christmas Red', rgbHex: '#E32636' }, // Bright Red (2)
  { dmcCode: '310', name: 'Black', rgbHex: '#000000' }, // Black border (3)
  { dmcCode: 'white', name: 'White', rgbHex: '#FFFFFF' }, // White highlight (4)
];
const heartTemplate = `
....................
....................
....................
......333....333....
.....31113..34413...
....31111133111113..
....31111111111113..
....31112222221113..
....31122222222113..
.....312222222213...
......3222222223....
.......32222223.....
........322223......
.........3223.......
..........33........
....................
....................
....................
....................
....................
`;

// 2. Cozy Flower (20x20)
const flowerPalette: PaletteEntry[] = [
  { dmcCode: '743', name: 'Medium Yellow', rgbHex: '#FCD116' }, // Yellow center (1)
  { dmcCode: '602', name: 'Medium Cranberry', rgbHex: '#E85A88' }, // Pink petals (2)
  { dmcCode: '700', name: 'Bright Green', rgbHex: '#009B77' }, // Green stem (3)
  { dmcCode: '310', name: 'Black', rgbHex: '#000000' }, // Black outline (4)
];
const flowerTemplate = `
....................
....................
....................
........4444........
......44222244......
.....4222222224.....
....422211112224....
....422111111224....
....422111111224....
....422211112224....
.....4222222224.....
......44222244......
........4444........
.........434........
.......43334........
......433334........
.......433434.......
........44434.......
..........3.........
....................
`;

// 3. Cute Star (20x20)
const starPalette: PaletteEntry[] = [
  { dmcCode: '725', name: 'Medium Light Topaz', rgbHex: '#FFC72C' }, // Yellow Gold (1)
  { dmcCode: '742', name: 'Light Tangerine', rgbHex: '#FF9E1B' }, // Orange Highlight (2)
  { dmcCode: '310', name: 'Black', rgbHex: '#000000' }, // Outline (3)
];
const starTemplate = `
....................
....................
.........33.........
........3113........
........3113........
.......311113.......
..3333311111133333..
...31111122111113...
....311122221113....
.....3112222113.....
....311122221113....
...31133333333113...
..3113........3113..
..333..........333..
....................
....................
....................
....................
....................
....................
`;

// 4. Mushroom (20x20)
const mushroomPalette: PaletteEntry[] = [
  { dmcCode: '321', name: 'Christmas Red', rgbHex: '#C51E3A' }, // Red (1)
  { dmcCode: 'white', name: 'White', rgbHex: '#FFFFFF' }, // White dots (2)
  { dmcCode: '437', name: 'Light Tan', rgbHex: '#E2B27E' }, // Stem (3)
  { dmcCode: '310', name: 'Black', rgbHex: '#000000' }, // Outline (4)
];
const mushroomTemplate = `
....................
....................
......444444........
....4411111144......
...411122221114.....
..41122222222114....
..41221111112214....
.4112111111112114...
.4111112222111114...
.4111122222211114...
..44443333334444....
....4333333334......
....4333333334......
....4333333334......
....4444444444......
....................
....................
....................
....................
....................
`;

const patterns = [
  {
    id: 'starter_heart',
    title: 'Cozy Heart',
    description: 'A sweet, simple heart pattern stitched in classic red tones.',
    width: 20,
    height: 20,
    palette: heartPalette,
    template: heartTemplate,
    difficulty: 'easy' as const,
  },
  {
    id: 'starter_flower',
    title: 'Cozy Flower',
    description: 'A cheerful blooming flower to brighten up your stitching table.',
    width: 20,
    height: 20,
    palette: flowerPalette,
    template: flowerTemplate,
    difficulty: 'easy' as const,
  },
  {
    id: 'starter_star',
    title: 'Cute Star',
    description: 'A bright, shining star in retro golden shades.',
    width: 20,
    height: 20,
    palette: starPalette,
    template: starTemplate,
    difficulty: 'easy' as const,
  },
  {
    id: 'starter_mushroom',
    title: 'Tiny Mushroom',
    description: 'A cute little woodland mushroom inspired by classic pixel games.',
    width: 20,
    height: 20,
    palette: mushroomPalette,
    template: mushroomTemplate,
    difficulty: 'easy' as const,
  },
];

const targetDir = path.resolve(__dirname, '../assets/bundled-patterns');
fs.mkdirSync(targetDir, { recursive: true });

interface ManifestEntry {
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
}

const manifest: ManifestEntry[] = [];

// Helper to parse Hex color to RGB
function parseHex(hex: string) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return { r, g, b };
}

for (const p of patterns) {
  const grid = createGrid(p.template, p.width, p.height);
  const patternData: PatternData = {
    schemaVersion: 1,
    width: p.width,
    height: p.height,
    palette: p.palette,
    grid,
  };

  // Encode
  const encoded = encodePatternArtifact(patternData);
  const checksum = sha256(encoded);
  const byteLength = encoded.length;

  // Write binary artifact
  const binPath = path.join(targetDir, `${p.id}.bin`);
  fs.writeFileSync(binPath, encoded);

  // Generate PNG Preview (upscale by 16)
  const scale = 16;
  const png = new PNG({ width: p.width * scale, height: p.height * scale });

  // Draw scaled pixel blocks
  for (let cy = 0; cy < p.height; cy++) {
    for (let cx = 0; cx < p.width; cx++) {
      const cellVal = grid[cy * p.width + cx];
      let r = 250, g = 246, b = 240, a = 0; // default transparent / linen background

      if (cellVal > 0) {
        const pal = p.palette[cellVal - 1];
        const rgb = parseHex(pal.rgbHex);
        r = rgb.r;
        g = rgb.g;
        b = rgb.b;
        a = 255;
      }

      // Fill scale x scale block
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = cx * scale + dx;
          const py = cy * scale + dy;
          const idx = (png.width * py + px) * 4;

          png.data[idx] = r;
          png.data[idx + 1] = g;
          png.data[idx + 2] = b;
          png.data[idx + 3] = a;
        }
      }
    }
  }

  const pngPath = path.join(targetDir, `${p.id}.png`);
  const pngBuffer = PNG.sync.write(png);
  fs.writeFileSync(pngPath, pngBuffer);

  // Count filled cells
  const filledCells = grid.filter(c => c > 0).length;

  // Add to manifest
  manifest.push({
    id: p.id,
    title: p.title,
    description: p.description,
    width: p.width,
    height: p.height,
    paletteSize: p.palette.length,
    checksum,
    byteLength,
    schemaVersion: 1,
    difficulty: p.difficulty,
    isPremium: false,
    colorsCount: p.palette.length,
    cellsCount: filledCells, // Number of filled cells/stitches
    createdAt: new Date().toISOString(),
  });

  console.log(`Generated ${p.title} (${p.id}): Binary size = ${byteLength} bytes, Checksum = ${checksum}`);
}

// Write manifest.json
fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('Successfully generated all bundled patterns and manifest.');
