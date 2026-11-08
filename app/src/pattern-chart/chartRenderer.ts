import { Platform } from 'react-native';
import { matchFont, Skia, ImageFormat } from '@shopify/react-native-skia';
import type { ChartDrawPlan } from './chartDrawPlan';

export class ChartRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChartRenderError';
  }
}

/**
 * Draws a plan on a CPU raster Skia surface and returns PNG bytes. Runs outside the stitching loop (ADR-0031).
 *
 * Skia API evidence, @shopify/react-native-skia@2.6.2 (node_modules/@shopify/react-native-skia/src):
 * - Skia.Surface.Make(width, height): CPU surface or null          skia/types/Surface/SurfaceFactory.ts:22
 * - Skia.XYWHRect, drawRect(rect, paint), drawLine(x0,y0,x1,y1,paint)  skia/types/Skia.ts:48, skia/types/Canvas.ts:197, :180
 * - drawText(text, x, y, paint, font)                              skia/types/Canvas.ts:338
 * - matchFont(style, fontMgr = Skia.FontMgr.System())              skia/core/Font.ts:81
 * - surface.makeImageSnapshot()                                    skia/types/Surface/Surface.ts:38
 * - image.encodeToBytes(ImageFormat.PNG, quality)                  skia/types/Image/Image.ts:122
 */
export function renderChartPng(plan: ChartDrawPlan): Uint8Array {
  const { canvasWidth, canvasHeight } = plan.layout;
  const surface = Skia.Surface.Make(canvasWidth, canvasHeight);
  if (!surface) throw new ChartRenderError('Could not create a drawing surface for the chart');
  const canvas = surface.getCanvas();
  const family = Platform.select({ ios: 'Helvetica', default: 'sans-serif' });
  const paint = Skia.Paint();
  paint.setAntiAlias(false);
  const textPaint = Skia.Paint();
  textPaint.setAntiAlias(true);

  for (const op of plan.ops) {
    if (op.type === 'rect') {
      paint.setColor(Skia.Color(op.color));
      canvas.drawRect(Skia.XYWHRect(op.x, op.y, op.width, op.height), paint);
    } else if (op.type === 'line') {
      paint.setColor(Skia.Color(op.color));
      paint.setStrokeWidth(op.strokeWidth);
      canvas.drawLine(op.x1, op.y1, op.x2, op.y2, paint);
    } else {
      const font = matchFont({ fontFamily: family, fontSize: op.size, fontWeight: op.bold ? 'bold' : 'normal' });
      textPaint.setColor(Skia.Color(op.color));
      canvas.drawText(op.text, op.x, op.y, textPaint, font);
    }
  }

  const image = surface.makeImageSnapshot();
  const bytes = image.encodeToBytes(ImageFormat.PNG, 100);
  if (bytes.length === 0) throw new ChartRenderError('Could not encode the chart as PNG');
  return bytes;
}
