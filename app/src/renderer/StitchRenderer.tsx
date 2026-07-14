import React, { useState, useEffect, useRef, useMemo } from 'react';
import { StyleSheet, View, LayoutChangeEvent, Text } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import {
  Canvas,
  Skia,
  Group,
  Picture,
  PaintStyle,
  type SkPicture,
} from '@shopify/react-native-skia';
import { useGameplayStore } from '../store/gameplayStore';
import {
  CELL_SIZE,
  TILE_SIZE,
  TILE_CELLS,
  getVisibleTiles,
  getLodBand,
} from './tileMath';
import { createSymbolAtlas, type SymbolAtlas } from './symbolAtlas';
import { RendererState } from './RendererState';
import { useRendererGesture } from './useRendererGesture';
import { PatternData } from '../pattern-artifact';
import { useDerivedValue } from 'react-native-reanimated';

export interface StitchRendererProps {
  pattern: PatternData;
  rendererState: RendererState;
  onCellTapped: (x: number, y: number) => void;
}

export function StitchRenderer({
  pattern,
  rendererState,
  onCellTapped,
}: StitchRendererProps) {
  // Local state revision to trigger React re-renders when gameplayState updates
  const [revision, setRevision] = useState(0);

  // Retrieve current selected color from store
  const { selectedColorIndex } = useGameplayStore();

  // Reference to track container size
  const containerWidthRef = useRef(0);
  const containerHeightRef = useRef(0);

  // Pre-render the symbol glyph atlas at load time
  const symbolAtlas = useMemo(() => {
    return createSymbolAtlas(pattern.palette.length);
  }, [pattern.palette.length]);

  // Picture Cache Maps
  // Key formats:
  // Base: `${tileX}_${tileY}_${lodBand}`
  // Completed: `${tileX}_${tileY}`
  // Overlay: `${tileX}_${tileY}`
  const baseCache = useRef<Map<string, SkPicture>>(new Map());
  const completedCache = useRef<Map<string, SkPicture>>(new Map());
  const overlayCache = useRef<Map<string, SkPicture>>(new Map());

  // Setup gesture handler via Reanimated
  const {
    scale,
    translateX,
    translateY,
    gesture,
    setContainerSize,
  } = useRendererGesture({
    patternWidth: pattern.width,
    patternHeight: pattern.height,
    maxScale: 3.0, // 48px / 16px = 3.0
    onCellTapped: (x, y) => {
      // Cell tap handler
      onCellTapped(x, y);
      // Increment local revision to trigger canvas refresh
      setRevision((r) => r + 1);
    },
  });

  // Track the viewport values in React state for culling.
  // We use useAnimatedReaction inside useRendererGesture (conceptually) to throttle this.
  // In this component, we trigger culling updates based on gesture movement or ended states.
  const [cullViewport, setCullViewport] = useState({
    scale: 1.0,
    translateX: 0.0,
    translateY: 0.0,
  });

  // Whenever the active selected color index changes, dirty all overlay tiles.
  useEffect(() => {
    rendererState.markAllOverlayDirty();
    setRevision((r) => r + 1);
  }, [selectedColorIndex, rendererState]);

  // Handle layout updates to setup initial fitting scale & center translate
  const handleLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    containerWidthRef.current = width;
    containerHeightRef.current = height;
    setContainerSize(width, height);

    // Set initial cull viewport
    setCullViewport({
      scale: scale.value,
      translateX: translateX.value,
      translateY: translateY.value,
    });
  };

  // Compute visible tiles based on cullViewport
  const visibleTiles = useMemo(() => {
    if (containerWidthRef.current === 0 || containerHeightRef.current === 0) {
      return [];
    }
    return getVisibleTiles(
      {
        scale: cullViewport.scale,
        translateX: cullViewport.translateX,
        translateY: cullViewport.translateY,
        width: containerWidthRef.current,
        height: containerHeightRef.current,
      },
      pattern.width,
      pattern.height,
      1 // prefetchMargin of 1 tile
    );
  }, [cullViewport, pattern.width, pattern.height]);

  // Update cull viewport after gesture ends or during large movements.
  // To keep it reactive, we update it at the end of tap gestures, layout changes,
  // and we can also update it on a small interval or scroll threshold if desired.
  // Let's force update cullViewport whenever local revision updates (which happens on tap/stitching).
  useEffect(() => {
    setCullViewport({
      scale: scale.value,
      translateX: translateX.value,
      translateY: translateY.value,
    });
  }, [revision]);

  // Also hook into a periodic check or update cullViewport when scale/translations settle
  useEffect(() => {
    const interval = setInterval(() => {
      // If scale or offset shifted significantly from cullViewport, synchronize it
      const scaleDiff = Math.abs(scale.value - cullViewport.scale);
      const distDiff = Math.hypot(
        translateX.value - cullViewport.translateX,
        translateY.value - cullViewport.translateY
      );

      if (scaleDiff > 0.05 || distDiff > 64.0) {
        setCullViewport({
          scale: scale.value,
          translateX: translateX.value,
          translateY: translateY.value,
        });
      }
    }, 100);

    return () => clearInterval(interval);
  }, [cullViewport, scale, translateX, translateY]);

  // Paint objects used inside recordings
  const minorGridPaint = useMemo(() => {
    const p = Skia.Paint();
    p.setColor(Skia.Color('#E6E1D8'));
    p.setStyle(PaintStyle.Stroke);
    p.setStrokeWidth(0.5);
    return p;
  }, []);

  const majorGridPaint = useMemo(() => {
    const p = Skia.Paint();
    p.setColor(Skia.Color('#B6AE9F'));
    p.setStyle(PaintStyle.Stroke);
    p.setStrokeWidth(1.0);
    return p;
  }, []);

  const spritePaint = useMemo(() => {
    const p = Skia.Paint();
    p.setAntiAlias(true);
    return p;
  }, []);

  const stitchPaint = useMemo(() => {
    const p = Skia.Paint();
    p.setAntiAlias(true);
    return p;
  }, []);

  const highlightPaint = useMemo(() => {
    const p = Skia.Paint();
    p.setAntiAlias(true);
    return p;
  }, []);

  const focusPaint = useMemo(() => {
    const p = Skia.Paint();
    p.setAntiAlias(true);
    p.setColor(Skia.Color('#FF4500')); // Vivid orange-red
    p.setStyle(PaintStyle.Stroke);
    p.setStrokeWidth(1.5);
    return p;
  }, []);

  // Compute LOD zoom band
  const lodBand = getLodBand(cullViewport.scale);

  // Count re-recordings for dev validation
  let completedReRecords = 0;

  // Pre-fetch/re-record visible tiles
  const renderedTiles = visibleTiles.map(({ tileX, tileY }) => {
    const baseKey = `${tileX}_${tileY}_${lodBand}`;
    const completedKey = `${tileX}_${tileY}`;
    const overlayKey = `${tileX}_${tileY}`;

    // --- 1. Base Picture (Immutable per LOD band) ---
    let basePic = baseCache.current.get(baseKey);
    if (!basePic) {
      const recorder = Skia.PictureRecorder();
      const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, TILE_SIZE, TILE_SIZE));

      // Draw grid lines
      if (lodBand === 'mid' || lodBand === 'readable') {
        for (let i = 0; i <= TILE_CELLS; i++) {
          const offset = i * CELL_SIZE;

          // Horizontal grid line
          const globalY = tileY * TILE_CELLS + i;
          if (globalY <= pattern.height) {
            const isMajor = globalY % 10 === 0;
            canvas.drawLine(0, offset, TILE_SIZE, offset, isMajor ? majorGridPaint : minorGridPaint);
          }

          // Vertical grid line
          const globalX = tileX * TILE_CELLS + i;
          if (globalX <= pattern.width) {
            const isMajor = globalX % 10 === 0;
            canvas.drawLine(offset, 0, offset, TILE_SIZE, isMajor ? majorGridPaint : minorGridPaint);
          }
        }
      }

      // Draw symbol glyphs from atlas
      if (lodBand === 'readable' && symbolAtlas) {
        for (let cy = 0; cy < TILE_CELLS; cy++) {
          for (let cx = 0; cx < TILE_CELLS; cx++) {
            const gx = tileX * TILE_CELLS + cx;
            const gy = tileY * TILE_CELLS + cy;

            if (gx < pattern.width && gy < pattern.height) {
              const colorIdx = pattern.grid[gy * pattern.width + gx];
              if (colorIdx > 0) {
                const srcX = (colorIdx - 1) * CELL_SIZE;
                canvas.drawImageRect(
                  symbolAtlas.image,
                  Skia.XYWHRect(srcX, 0, CELL_SIZE, CELL_SIZE),
                  Skia.XYWHRect(cx * CELL_SIZE, cy * CELL_SIZE, CELL_SIZE, CELL_SIZE),
                  spritePaint
                );
              }
            }
          }
        }
      }

      basePic = recorder.finishRecordingAsPicture();
      baseCache.current.set(baseKey, basePic);
    }

    // --- 2. Completed stitches Picture (Re-recorded on cell state changes) ---
    const isCompletedDirty = rendererState.checkAndClearCompletedDirty(tileX, tileY);
    let completedPic = completedCache.current.get(completedKey);

    if (!completedPic || isCompletedDirty) {
      completedReRecords++;
      const recorder = Skia.PictureRecorder();
      const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, TILE_SIZE, TILE_SIZE));

      for (let cy = 0; cy < TILE_CELLS; cy++) {
        for (let cx = 0; cx < TILE_CELLS; cx++) {
          const gx = tileX * TILE_CELLS + cx;
          const gy = tileY * TILE_CELLS + cy;

          if (gx < pattern.width && gy < pattern.height) {
            if (rendererState.isCompleted(gx, gy)) {
              const colorIdx = pattern.grid[gy * pattern.width + gx];
              if (colorIdx > 0) {
                const colorHex = pattern.palette[colorIdx - 1].rgbHex;
                stitchPaint.setColor(Skia.Color(colorHex));
                stitchPaint.setStyle(PaintStyle.Fill);

                // Draw filled square with a tiny 0.5px gap to make individual stitches look distinct
                canvas.drawRect(
                  Skia.XYWHRect(
                    cx * CELL_SIZE + 0.5,
                    cy * CELL_SIZE + 0.5,
                    CELL_SIZE - 1.0,
                    CELL_SIZE - 1.0
                  ),
                  stitchPaint
                );
              }
            }
          }
        }
      }

      completedPic = recorder.finishRecordingAsPicture();
      completedCache.current.set(completedKey, completedPic);
    }

    // --- 3. Overlay Picture (Selected color highlight + Focus ring placeholder) ---
    const isOverlayDirty = rendererState.checkAndClearOverlayDirty(tileX, tileY);
    let overlayPic = overlayCache.current.get(overlayKey);

    if (!overlayPic || isOverlayDirty) {
      const recorder = Skia.PictureRecorder();
      const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, TILE_SIZE, TILE_SIZE));

      const focusedCell = rendererState.getFocusedCell();

      for (let cy = 0; cy < TILE_CELLS; cy++) {
        for (let cx = 0; cx < TILE_CELLS; cx++) {
          const gx = tileX * TILE_CELLS + cx;
          const gy = tileY * TILE_CELLS + cy;

          if (gx < pattern.width && gy < pattern.height) {
            const colorIdx = pattern.grid[gy * pattern.width + gx];

            // 3.1 selected color highlight (subtle outline + semi-transparent fill)
            if (
              colorIdx > 0 &&
              colorIdx - 1 === selectedColorIndex &&
              !rendererState.isCompleted(gx, gy)
            ) {
              const colorHex = pattern.palette[colorIdx - 1].rgbHex;

              // Draw semi-transparent background fill
              const fillCol = Skia.Color(colorHex);
              fillCol[3] = 0.2; // 20% opacity
              highlightPaint.setColor(fillCol);
              highlightPaint.setStyle(PaintStyle.Fill);
              canvas.drawRect(
                Skia.XYWHRect(
                  cx * CELL_SIZE + 1.0,
                  cy * CELL_SIZE + 1.0,
                  CELL_SIZE - 2.0,
                  CELL_SIZE - 2.0
                ),
                highlightPaint
              );

              // Draw outline border
              highlightPaint.setColor(Skia.Color(colorHex));
              highlightPaint.setStyle(PaintStyle.Stroke);
              highlightPaint.setStrokeWidth(1.0);
              canvas.drawRect(
                Skia.XYWHRect(
                  cx * CELL_SIZE + 1.0,
                  cy * CELL_SIZE + 1.0,
                  CELL_SIZE - 2.0,
                  CELL_SIZE - 2.0
                ),
                highlightPaint
              );
            }

            // 3.2 Focus ring locator placeholder
            if (gx === focusedCell.x && gy === focusedCell.y) {
              canvas.drawRect(
                Skia.XYWHRect(
                  cx * CELL_SIZE + 1.0,
                  cy * CELL_SIZE + 1.0,
                  CELL_SIZE - 2.0,
                  CELL_SIZE - 2.0
                ),
                focusPaint
              );
            }
          }
        }
      }

      overlayPic = recorder.finishRecordingAsPicture();
      overlayCache.current.set(overlayKey, overlayPic);
    }

    return {
      tileX,
      tileY,
      basePic,
      completedPic,
      overlayPic,
    };
  });

  // Dev log for re-recorded tiles
  if (__DEV__ && completedReRecords > 0) {
    console.log(
      `[StitchRenderer] Completed-stitches layer re-recorded: ${completedReRecords} tiles`
    );
  }

  // --- 4. Bounded Cache Eviction ---
  // Prune tiles that are no longer in the visible region (plus margin) from the caches
  useEffect(() => {
    const visibleKeys = new Set(visibleTiles.map((t) => `${t.tileX}_${t.tileY}`));

    // Evict completed cache
    for (const key of completedCache.current.keys()) {
      if (!visibleKeys.has(key)) {
        completedCache.current.delete(key);
      }
    }

    // Evict overlay cache
    for (const key of overlayCache.current.keys()) {
      if (!visibleKeys.has(key)) {
        overlayCache.current.delete(key);
      }
    }

    // Evict base cache (lod band is appended)
    const baseVisibleKeys = new Set(
      visibleTiles.map((t) => `${t.tileX}_${t.tileY}_${lodBand}`)
    );
    for (const key of baseCache.current.keys()) {
      if (!baseVisibleKeys.has(key)) {
        baseCache.current.delete(key);
      }
    }
  }, [visibleTiles, lodBand]);

  // Setup dynamic transform array for Reanimated/Skia
  const skiaTransform = useDerivedValue(() => [
    { translateX: translateX.value },
    { translateY: translateY.value },
    { scale: scale.value },
  ]);

  return (
    <View style={styles.container} onLayout={handleLayout}>
      <GestureDetector gesture={gesture}>
        <Canvas style={styles.canvas}>
          {/* Offscreen Fabric Base Background */}
          <Group transform={skiaTransform}>
            {renderedTiles.map(({ tileX, tileY, basePic, completedPic, overlayPic }) => {
              const key = `${tileX}_${tileY}`;
              return (
                <Group
                  key={key}
                  transform={[{ translateX: tileX * TILE_SIZE }, { translateY: tileY * TILE_SIZE }]}
                >
                  {basePic && <Picture picture={basePic} />}
                  {completedPic && <Picture picture={completedPic} />}
                  {overlayPic && <Picture picture={overlayPic} />}
                </Group>
              );
            })}
          </Group>
        </Canvas>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF6F0', // Premium Aida fabric color
    overflow: 'hidden',
  },
  canvas: {
    flex: 1,
  },
});
