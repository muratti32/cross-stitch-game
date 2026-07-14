import { Platform } from 'react-native';
import { Skia, matchFont, type SkImage } from '@shopify/react-native-skia';
import { CELL_SIZE } from './tileMath';

export interface SymbolAtlas {
  image: SkImage;
  cellSize: number;
  paletteSize: number;
}

/**
 * Pre-renders the numbers (1..N) for N palette entries into a single offscreen image.
 * This is used to draw thread color symbols as sprites, avoiding per-frame text layout.
 */
export function createSymbolAtlas(paletteSize: number): SymbolAtlas | null {
  if (paletteSize <= 0) return null;

  const width = paletteSize * CELL_SIZE;
  const height = CELL_SIZE;

  const surface = Skia.Surface.Make(width, height);
  if (!surface) {
    console.error('Failed to create Skia offscreen surface for symbol atlas.');
    return null;
  }

  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('transparent'));

  // Load system sans-serif font
  const fontFamily = Platform.select({ ios: 'Helvetica', default: 'sans-serif' });
  const fontSize = CELL_SIZE * 0.65; // Leave small margin inside the 16x16 cell

  let font;
  try {
    font = matchFont({
      fontFamily,
      fontSize,
      fontStyle: 'normal',
      fontWeight: 'bold', // bold symbols are easier to read
    });
  } catch (e) {
    console.error('Failed to match font for symbol atlas:', e);
    return null;
  }

  const paint = Skia.Paint();
  paint.setColor(Skia.Color('#2C2C2C')); // Dark grey text color
  paint.setAntiAlias(true);

  const metrics = font.getMetrics();

  for (let i = 0; i < paletteSize; i++) {
    const text = String(i + 1);
    const bounds = font.measureText(text);

    // Compute bounds to center the text in the CELL_SIZE * CELL_SIZE box
    const cellLeft = i * CELL_SIZE;
    const x = cellLeft + (CELL_SIZE - bounds.width) / 2 - bounds.x;
    // vertical center based on font metrics
    const y = (CELL_SIZE - metrics.ascent - metrics.descent) / 2;

    canvas.drawText(text, x, y, paint, font);
  }

  const image = surface.makeImageSnapshot();

  return {
    image,
    cellSize: CELL_SIZE,
    paletteSize,
  };
}
