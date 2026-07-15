export interface FramingTransform {
  frameHeight: number;
  frameWidth: number;
  offsetX: number;
  offsetY: number;
  sourceHeight: number;
  sourceWidth: number;
  zoom: number;
}

export interface CropRectangle {
  height: number;
  originX: number;
  originY: number;
  width: number;
}

export function computeCropRectangle(input: FramingTransform): CropRectangle {
  const baseScale = Math.max(
    input.frameWidth / input.sourceWidth,
    input.frameHeight / input.sourceHeight,
  );
  const scale = baseScale * Math.max(1, input.zoom);
  const renderedWidth = input.sourceWidth * scale;
  const renderedHeight = input.sourceHeight * scale;
  const maxOffsetX = Math.max(0, (renderedWidth - input.frameWidth) / 2);
  const maxOffsetY = Math.max(0, (renderedHeight - input.frameHeight) / 2);
  const offsetX = clamp(input.offsetX, -maxOffsetX, maxOffsetX);
  const offsetY = clamp(input.offsetY, -maxOffsetY, maxOffsetY);

  let width = Math.max(1, Math.round(input.frameWidth / scale));
  let height = Math.max(1, Math.round(input.frameHeight / scale));
  width = Math.min(width, input.sourceWidth);
  height = Math.min(height, input.sourceHeight);
  if (width > height * 6) {
    width = height * 6;
  }
  if (height > width * 6) {
    height = width * 6;
  }

  const visibleLeft = (renderedWidth - input.frameWidth) / 2 - offsetX;
  const visibleTop = (renderedHeight - input.frameHeight) / 2 - offsetY;
  const originX = clamp(
    Math.round(visibleLeft / scale),
    0,
    input.sourceWidth - width,
  );
  const originY = clamp(
    Math.round(visibleTop / scale),
    0,
    input.sourceHeight - height,
  );
  return { height, originX, originY, width };
}

export function downscaledDimensions(
  width: number,
  height: number,
  maxLongEdge = 2048,
): { width: number; height: number } {
  if (Math.max(width, height) <= maxLongEdge) {
    return { width, height };
  }
  const scale = maxLongEdge / Math.max(width, height);
  return {
    height: Math.max(1, Math.round(height * scale)),
    width: Math.max(1, Math.round(width * scale)),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
