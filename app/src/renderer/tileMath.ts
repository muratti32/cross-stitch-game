export const CELL_SIZE = 16.0;
export const TILE_CELLS = 32;
export const TILE_SIZE = CELL_SIZE * TILE_CELLS; // 512.0

export interface Viewport {
  translateX: number;
  translateY: number;
  scale: number;
  width: number;
  height: number;
}

export type LodBand = 'out' | 'mid' | 'readable';

/**
 * Maps a grid cell coordinate to tile coordinates.
 */
export function getTileCoords(cellX: number, cellY: number): { tileX: number; tileY: number } {
  return {
    tileX: Math.floor(cellX / TILE_CELLS),
    tileY: Math.floor(cellY / TILE_CELLS),
  };
}

/**
 * Gets the bounding box of a tile in pattern coordinates.
 */
export function getTileBounds(tileX: number, tileY: number) {
  const left = tileX * TILE_SIZE;
  const top = tileY * TILE_SIZE;
  return {
    left,
    top,
    right: left + TILE_SIZE,
    bottom: top + TILE_SIZE,
  };
}

/**
 * Calculates the set of visible tiles intersecting the viewport,
 * plus a prefetch margin. Clamps output coordinates to pattern bounds.
 */
export function getVisibleTiles(
  viewport: Viewport,
  patternWidth: number,
  patternHeight: number,
  prefetchMargin = 1
): { tileX: number; tileY: number }[] {
  const { translateX, translateY, scale, width: viewW, height: viewH } = viewport;

  if (scale <= 0) return [];

  // Map viewport screen coordinates back to pattern space
  // screen_pos = pattern_pos * scale + translate
  // => pattern_pos = (screen_pos - translate) / scale
  const patLeft = -translateX / scale;
  const patTop = -translateY / scale;
  const patRight = (viewW - translateX) / scale;
  const patBottom = (viewH - translateY) / scale;

  // Convert pattern coordinates to cell coordinates
  const minCellX = Math.floor(patLeft / CELL_SIZE);
  const minCellY = Math.floor(patTop / CELL_SIZE);
  // Subtract a tiny epsilon to avoid off-by-one boundary inclusion
  const maxCellX = Math.max(minCellX, Math.ceil(patRight / CELL_SIZE) - 1);
  const maxCellY = Math.max(minCellY, Math.ceil(patBottom / CELL_SIZE) - 1);

  // Map cell coordinates to tile coordinates
  const minTileX = Math.floor(minCellX / TILE_CELLS) - prefetchMargin;
  const minTileY = Math.floor(minCellY / TILE_CELLS) - prefetchMargin;
  const maxTileX = Math.floor(maxCellX / TILE_CELLS) + prefetchMargin;
  const maxTileY = Math.floor(maxCellY / TILE_CELLS) + prefetchMargin;

  const totalTilesX = Math.ceil(patternWidth / TILE_CELLS);
  const totalTilesY = Math.ceil(patternHeight / TILE_CELLS);

  const visibleTiles: { tileX: number; tileY: number }[] = [];

  const startTileX = Math.max(0, minTileX);
  const endTileX = Math.min(totalTilesX - 1, maxTileX);
  const startTileY = Math.max(0, minTileY);
  const endTileY = Math.min(totalTilesY - 1, maxTileY);

  for (let ty = startTileY; ty <= endTileY; ty++) {
    for (let tx = startTileX; tx <= endTileX; tx++) {
      visibleTiles.push({ tileX: tx, tileY: ty });
    }
  }

  return visibleTiles;
}

/**
 * Returns the Level Of Detail (LOD) band based on current on-screen cell size in pixels.
 */
export function getLodBand(scale: number): LodBand {
  const cellPx = scale * CELL_SIZE;
  if (cellPx < 6.0) {
    return 'out';
  } else if (cellPx <= 14.0) {
    return 'mid';
  } else {
    return 'readable';
  }
}

/**
 * Computes fit-to-screen scale and translation to fit the pattern inside the viewport.
 */
export function getFitViewport(
  patternWidth: number,
  patternHeight: number,
  viewWidth: number,
  viewHeight: number
): { scale: number; translateX: number; translateY: number } {
  if (viewWidth <= 0 || viewHeight <= 0) {
    return { scale: 1.0, translateX: 0, translateY: 0 };
  }
  const patW = patternWidth * CELL_SIZE;
  const patH = patternHeight * CELL_SIZE;

  // Fit scale is limited by viewport aspect ratio
  const scale = Math.min(viewWidth / patW, viewHeight / patH);

  // Center the fitted pattern in the viewport
  const translateX = (viewWidth - patW * scale) / 2;
  const translateY = (viewHeight - patH * scale) / 2;

  return { scale, translateX, translateY };
}

/**
 * Returns the valid translation range for one content dimension.
 */
export function translationBounds(
  containerSize: number,
  contentSize: number,
  slackBefore: number = 0,
  slackAfter: number = 0,
): { min: number; max: number } {
  'worklet';
  if (contentSize > containerSize) {
    return {
      min: containerSize - contentSize - slackAfter,
      max: slackBefore,
    };
  }

  const center = (containerSize - contentSize) / 2;
  return {
    min: center - slackAfter,
    max: center + slackBefore,
  };
}

/**
 * Clamps a translation to the valid range for one content dimension.
 */
export function clampTranslation(
  translate: number,
  containerSize: number,
  contentSize: number,
  slackBefore: number = 0,
  slackAfter: number = 0,
): number {
  'worklet';
  const { min, max } = translationBounds(containerSize, contentSize, slackBefore, slackAfter);
  return Math.max(min, Math.min(max, translate));
}

/**
 * Clamps scale and computes correct translations for zoom-to-point gestures,
 * keeping the anchor point in screen coordinates stationary.
 */
export function getAnchoredZoomTransform(
  currentScale: number,
  currentTx: number,
  currentTy: number,
  targetScale: number,
  anchorScreenX: number,
  anchorScreenY: number,
  minScale: number,
  maxScale: number,
  patternWidth: number,
  patternHeight: number,
  viewWidth: number,
  viewHeight: number
): { scale: number; translateX: number; translateY: number } {
  const scale = Math.max(minScale, Math.min(maxScale, targetScale));

  // Determine bounds on translation to avoid panning past boundaries
  const patW = patternWidth * CELL_SIZE;
  const patH = patternHeight * CELL_SIZE;

  // Target translation keeping anchor screen position fixed
  // anchorScreenX = anchorPatX * scale + newTx
  // anchorPatX = (anchorScreenX - currentTx) / currentScale
  // => newTx = anchorScreenX - (anchorScreenX - currentTx) * (scale / currentScale)
  const newTx = anchorScreenX - (anchorScreenX - currentTx) * (scale / currentScale);
  const newTy = anchorScreenY - (anchorScreenY - currentTy) * (scale / currentScale);

  // Clamp translations:
  // If scaled content fits in viewport, center it.
  // Otherwise clamp between viewWidth - patW * scale and 0.
  const clampDim = (t: number, viewDim: number, contentDim: number): number => {
    const scaled = contentDim * scale;
    if (scaled <= viewDim) {
      return (viewDim - scaled) / 2;
    }
    return Math.max(viewDim - scaled, Math.min(0, t));
  };

  const translateX = clampDim(newTx, viewWidth, patW);
  const translateY = clampDim(newTy, viewHeight, patH);

  return { scale, translateX, translateY };
}

/**
 * Cycles deterministically to the next unfinished cell index of the active thread color in row-major order.
 * Returns the cell index, or null if none exist or color has no cells.
 */
export function nextRemainingCell(
  grid: Uint8Array,
  completed: Uint8Array,
  width: number,
  height: number,
  activeColor: number,
  fromIndex: number
): number | null {
  const size = width * height;
  if (size === 0 || grid.length !== size || completed.length !== size) return null;

  const start = (fromIndex + 1) % size;

  for (let i = 0; i < size; i++) {
    const idx = (start + i) % size;
    if (grid[idx] === activeColor + 1 && completed[idx] === 0) {
      return idx;
    }
  }

  return null;
}

/**
 * Proximity to edge velocity calculation.
 */
export function computeEdgePanVelocity(
  fingerPos: number,
  containerSize: number,
  edgeMargin: number,
  maxSpeed: number
): number {
  'worklet';
  if (fingerPos < edgeMargin) {
    const proximity = Math.max(0, edgeMargin - fingerPos);
    const ratio = Math.min(1, proximity / edgeMargin);
    return ratio * maxSpeed;
  }
  if (fingerPos > containerSize - edgeMargin) {
    const proximity = Math.max(0, fingerPos - (containerSize - edgeMargin));
    const ratio = Math.min(1, proximity / edgeMargin);
    return -ratio * maxSpeed;
  }
  return 0;
}
