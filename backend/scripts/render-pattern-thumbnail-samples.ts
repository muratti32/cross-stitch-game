import * as fs from 'fs';
import * as path from 'path';
import { renderPatternThumbnailPng } from '../src/conversion/pattern-thumbnail-renderer';

const DMC_COLORS = [
  { dmcCode: '310', name: 'Black', rgbHex: '#000000' },
  { dmcCode: 'BLANC', name: 'White', rgbHex: '#FFFFFF' },
  { dmcCode: '321', name: 'Red', rgbHex: '#C5102E' },
  { dmcCode: '666', name: 'Bright Red', rgbHex: '#E71A37' },
  { dmcCode: '796', name: 'Dark Royal Blue', rgbHex: '#102F76' },
  { dmcCode: '906', name: 'Medium Parrot Green', rgbHex: '#529F2B' },
  { dmcCode: '972', name: 'Light Curry', rgbHex: '#FDBB2B' },
  { dmcCode: '743', name: 'Medium Yellow', rgbHex: '#FDCB58' },
  { dmcCode: '917', name: 'Medium Plum', rgbHex: '#841B5C' },
  { dmcCode: '995', name: 'Dark Electric Blue', rgbHex: '#007AA5' },
  { dmcCode: '602', name: 'Medium Cranberry', rgbHex: '#E25482' },
  { dmcCode: '702', name: 'Kelly Green', rgbHex: '#258E3C' },
  { dmcCode: '740', name: 'Tangerine', rgbHex: '#FF7F00' },
  { dmcCode: '820', name: 'Very Dark Royal Blue', rgbHex: '#0A1C50' },
  { dmcCode: '907', name: 'Light Parrot Green', rgbHex: '#82C341' },
  { dmcCode: '947', name: 'Burnt Orange', rgbHex: '#FF5E00' },
  { dmcCode: '3823', name: 'Ultra Pale Yellow', rgbHex: '#FFFCE2' },
  { dmcCode: '210', name: 'Medium Lavender', rgbHex: '#C6A2CC' },
  { dmcCode: '334', name: 'Medium Baby Blue', rgbHex: '#7AA9D0' },
  { dmcCode: '996', name: 'Medium Electric Blue', rgbHex: '#3BB9FF' },
  { dmcCode: '606', name: 'Bright Orange-Red', rgbHex: '#FF2A00' },
  { dmcCode: '704', name: 'Bright Chartreuse', rgbHex: '#A2E01E' },
  { dmcCode: '741', name: 'Medium Tangerine', rgbHex: '#FF9E00' },
  { dmcCode: '823', name: 'Super Dark Blue', rgbHex: '#000040' },
  { dmcCode: '905', name: 'Dark Parrot Green', rgbHex: '#3D771E' },
  { dmcCode: '946', name: 'Medium Burnt Orange', rgbHex: '#FF6F00' },
];

function makeLowPalette16x16() {
  const width = 16;
  const height = 16;
  const palette = [
    { dmcCode: '310', name: 'Black', rgbHex: '#000000' },
    { dmcCode: '321', name: 'Red', rgbHex: '#C5102E' },
  ];
  const grid = new Uint8Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const dist = Math.sqrt((r - 7.5) ** 2 + (c - 7.5) ** 2);
      if (dist < 6 && dist > 4) {
        grid[r * width + c] = 1;
      } else if (dist < 3) {
        grid[r * width + c] = 2;
      }
    }
  }
  return { name: 'low-palette-16x16', width, height, palette, grid };
}

function makeMidSize64x64() {
  const width = 64;
  const height = 64;
  const palette = [
    { dmcCode: '796', name: 'Dark Royal Blue', rgbHex: '#102F76' },
    { dmcCode: '972', name: 'Light Curry', rgbHex: '#FDBB2B' },
  ];
  const grid = new Uint8Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      if ((Math.floor(r / 8) + Math.floor(c / 8)) % 2 === 0) {
        grid[r * width + c] = 1;
      } else {
        grid[r * width + c] = 2;
      }
    }
  }
  return { name: 'mid-size-64x64', width, height, palette, grid };
}

function makeMaxSize300x300() {
  const width = 300;
  const height = 300;
  const palette = [
    { dmcCode: '906', name: 'Medium Parrot Green', rgbHex: '#529F2B' },
    { dmcCode: '995', name: 'Dark Electric Blue', rgbHex: '#007AA5' },
  ];
  const grid = new Uint8Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const rx = r - 150;
      const cy = c - 150;
      if ((rx * rx + cy * cy) % 1000 < 500) {
        grid[r * width + c] = 1;
      } else {
        grid[r * width + c] = 2;
      }
    }
  }
  return { name: 'max-size-300x300', width, height, palette, grid };
}

function makeExtremeWide120x20() {
  const width = 120;
  const height = 20;
  const palette = [
    { dmcCode: '917', name: 'Medium Plum', rgbHex: '#841B5C' },
    { dmcCode: '602', name: 'Medium Cranberry', rgbHex: '#E25482' },
  ];
  const grid = new Uint8Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      grid[r * width + c] = (r + c) % 2 === 0 ? 1 : 2;
    }
  }
  return { name: 'extreme-wide-120x20', width, height, palette, grid };
}

function makeExtremeTall20x120() {
  const width = 20;
  const height = 120;
  const palette = [
    { dmcCode: '702', name: 'Kelly Green', rgbHex: '#258E3C' },
    { dmcCode: '740', name: 'Tangerine', rgbHex: '#FF7F00' },
  ];
  const grid = new Uint8Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      grid[r * width + c] = (r + c) % 2 === 0 ? 1 : 2;
    }
  }
  return { name: 'extreme-tall-20x120', width, height, palette, grid };
}

function makeHighPaletteCount() {
  const width = 48;
  const height = 48;
  const palette = DMC_COLORS;
  const grid = new Uint8Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const idx = (Math.floor(r / 2) + Math.floor(c / 2)) % palette.length;
      grid[r * width + c] = idx + 1;
    }
  }
  return { name: 'high-palette-count-48x48', width, height, palette, grid };
}

function main() {
  const args = process.argv.slice(2);
  const outDir = args[0] || './tmp/thumbnail-samples';

  fs.mkdirSync(outDir, { recursive: true });

  const cases = [
    makeLowPalette16x16(),
    makeMidSize64x64(),
    makeMaxSize300x300(),
    makeExtremeWide120x20(),
    makeExtremeTall20x120(),
    makeHighPaletteCount(),
  ];

  let totalFiles = 0;
  let totalBytes = 0;

  for (const c of cases) {
    const variants: ('browsing' | 'detail')[] = ['browsing', 'detail'];
    for (const variant of variants) {
      const buffer = renderPatternThumbnailPng({
        width: c.width,
        height: c.height,
        palette: c.palette,
        grid: c.grid,
        variant,
      });

      const filename = `${c.name}-${variant}.png`;
      const filepath = path.join(outDir, filename);
      fs.writeFileSync(filepath, buffer);

      const sizePx = variant === 'browsing' ? 512 : 1536;
      console.log(
        `Wrote ${filepath} (${sizePx}x${sizePx}, ${buffer.length} bytes)`,
      );

      totalFiles++;
      totalBytes += buffer.length;
    }
  }

  console.log(
    `Summary: Rendered ${totalFiles} sample images inside ${outDir} (${totalBytes} bytes total).`,
  );
}

main();
