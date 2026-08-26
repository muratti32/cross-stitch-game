import React, { useState, useEffect, useRef, useMemo, useImperativeHandle, useCallback } from 'react';
import { AccessibilityInfo, StyleSheet, View, LayoutChangeEvent, Text } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import {
  Canvas,
  Skia,
  Group,
  Picture,
  PaintStyle,
  Line,
  Rect,
  vec,
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
import { deriveThreadSurfaceColors } from './completedStitchVisualState';
import { useRendererGesture } from './useRendererGesture';
import { PatternData } from '../pattern-artifact';
import {
  useDerivedValue,
  useAnimatedReaction,
  useSharedValue,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated';
import { TilePictureCache, TILE_CACHE_BUDGET } from './pictureCache';
import {
  DEFAULT_MEMBERSHIP_THEME,
  type MembershipTheme,
} from '../membership/themes';

export interface StitchRendererProps {
  pattern: PatternData;
  rendererState: RendererState;
  onCellTapped: (x: number, y: number) => void;
  onSweepStitch?: (x: number, y: number, gestureId: number) => void;
  onPinch?: () => void;
  onPlainDragWithoutStitch?: () => void;
  onEdgeAutoPan?: () => void;
  gridShared: SharedValue<Uint8Array>;
  completedShared: SharedValue<Uint8Array>;
  activeColorIndexShared: SharedValue<number>;
  isColorCompletedShared: SharedValue<boolean>;
  parentRevision?: number;
  theme?: MembershipTheme;
  panSlack?: { left?: number; right?: number; top?: number; bottom?: number };
  scaleShared?: SharedValue<number>;
  translateXShared?: SharedValue<number>;
  translateYShared?: SharedValue<number>;
  containerWidthShared?: SharedValue<number>;
  containerHeightShared?: SharedValue<number>;
}

export interface StitchRendererRef {
  locateCell: (cx: number, cy: number) => void;
  placeCompletedStitch: (cx: number, cy: number) => void;
  undoCompletedStitch: (cx: number, cy: number) => void;
  settleCompletedStitch: (cx: number, cy: number) => void;
}

export const StitchRenderer = React.forwardRef<StitchRendererRef, StitchRendererProps>((
  {
    pattern,
    rendererState,
    onCellTapped,
    onSweepStitch,
    onPinch,
    onPlainDragWithoutStitch,
    onEdgeAutoPan,
    gridShared,
    completedShared,
    activeColorIndexShared,
    isColorCompletedShared,
    parentRevision,
    theme = DEFAULT_MEMBERSHIP_THEME,
    panSlack,
    scaleShared,
    translateXShared,
    translateYShared,
    containerWidthShared,
    containerHeightShared,
  },
  ref
) => {
  // Local state revision to trigger React re-renders when gameplayState updates
  const [revision, setRevision] = useState(0);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [visualNow, setVisualNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (!cancelled) setReduceMotion(value);
      })
      .catch(() => {
        if (!cancelled) setReduceMotion(false);
      });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion !== true) return;
    rendererState.settleAllCompletedStitches();
    setVisualNow(Date.now());
    setRevision((r) => r + 1);
  }, [reduceMotion, rendererState]);

  useEffect(() => {
    if (!rendererState.hasActiveCompletedStitchVisuals()) return;
    const timer = setInterval(() => {
      const now = Date.now();
      const hasActiveVisuals = rendererState.advanceCompletedStitchVisuals(now);
      setVisualNow(now);
      if (!hasActiveVisuals) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  }, [rendererState, revision]);

  // Sync parent revision
  useEffect(() => {
    setRevision((r) => r + 1);
  }, [parentRevision]);

  // Retrieve current selected color from store
  const { selectedColorIndex } = useGameplayStore();

  // Reference to track container size
  const containerWidthRef = useRef(0);
  const containerHeightRef = useRef(0);

  // Pre-render the symbol glyph atlas at load time
  const symbolAtlas = useMemo(() => {
    return createSymbolAtlas(pattern.palette.length);
  }, [pattern.palette.length]);

  // LRU Picture Caches (bounded, pruned when the viewport settles)
  // Key formats:
  // Base: `${tileX}_${tileY}_${lodBand}`
  // Completed: `${tileX}_${tileY}`
  // Overlay: `${tileX}_${tileY}`
  const baseCache = useRef<TilePictureCache>(new TilePictureCache());
  const completedCache = useRef<TilePictureCache>(new TilePictureCache());
  const overlayCache = useRef<TilePictureCache>(new TilePictureCache());

  // Setup gesture handler via Reanimated
  const {
    scale,
    translateX,
    translateY,
    gesture,
    setContainerSize,
    locateCell,
  } = useRendererGesture({
    patternWidth: pattern.width,
    patternHeight: pattern.height,
    maxScale: 3.0, // 48px / 16px = 3.0
    onCellTapped: (x, y) => {
      onCellTapped(x, y);
      setRevision((r) => r + 1);
    },
    onSweepStitch: (x, y, gestureId) => {
      if (onSweepStitch) {
        onSweepStitch(x, y, gestureId);
      }
      setRevision((r) => r + 1);
    },
    onPinch,
    onPlainDragWithoutStitch,
    onEdgeAutoPan,
    gridShared,
    completedShared,
    activeColorIndexShared,
    isColorCompletedShared,
    panSlack,
    scaleShared,
    translateXShared,
    translateYShared,
    containerWidthShared,
    containerHeightShared,
  });

  useImperativeHandle(ref, () => ({
    locateCell: (cx, cy) => {
      locateCell(cx, cy);
    },
    placeCompletedStitch: (cx, cy) => {
      rendererState.placeCompletedStitch(
        cx,
        cy,
        getLodBand(scale.value),
        Date.now(),
        reduceMotion !== false,
      );
      setVisualNow(Date.now());
      setRevision((r) => r + 1);
    },
    undoCompletedStitch: (cx, cy) => {
      rendererState.undoCompletedStitch(cx, cy, Date.now(), reduceMotion !== false);
      setVisualNow(Date.now());
      setRevision((r) => r + 1);
    },
    settleCompletedStitch: (cx, cy) => {
      rendererState.settleCompletedStitch(cx, cy);
      setRevision((r) => r + 1);
    },
  }), [locateCell, reduceMotion, rendererState, scale]);

  // Track the viewport values in React state for culling.
  // A UI-thread useAnimatedReaction below watches the transform shared values
  // and pushes throttled updates here; a settle timer marks when movement stops.
  const [cullViewport, setCullViewport] = useState({
    scale: 1.0,
    translateX: 0.0,
    translateY: 0.0,
  });

  // True while the viewport transform is actively changing (gesture or decay).
  // While moving, missing tile pictures are NOT recorded (ADR-0034: no picture
  // re-recording inside the gesture); they fill in once the viewport settles.
  const [viewportMoving, setViewportMoving] = useState(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    // Set initial cull viewport and sync the reaction baseline so the initial
    // fit transform is not mistaken for gesture movement.
    lastSentScale.value = scale.value;
    lastSentTx.value = translateX.value;
    lastSentTy.value = translateY.value;
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
      2 // prefetchMargin of 2 tiles: hides culling latency during fast scroll
    );
  }, [cullViewport, pattern.width, pattern.height]);

  // Update cull viewport whenever local revision updates (tap/stitching).
  useEffect(() => {
    setCullViewport({
      scale: scale.value,
      translateX: translateX.value,
      translateY: translateY.value,
    });
  }, [revision]);

  // JS-side receiver for throttled viewport updates from the UI thread.
  // Each call marks the viewport as moving and re-arms the settle timer; when
  // no update arrives for the settle window, the viewport is declared settled
  // and deferred tile recording resumes with the exact final transform.
  const handleViewportChange = useCallback(
    (s: number, tx: number, ty: number) => {
      setViewportMoving(true);
      setCullViewport({ scale: s, translateX: tx, translateY: ty });

      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => {
        settleTimer.current = null;
        setViewportMoving(false);
        setCullViewport({
          scale: scale.value,
          translateX: translateX.value,
          translateY: translateY.value,
        });
      }, 160);
    },
    [scale, translateX, translateY]
  );

  useEffect(() => {
    return () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
  }, []);

  // UI-thread reaction: watches the transform shared values and dispatches a
  // culling update when movement exceeds the threshold, throttled to at most
  // one dispatch per 100 ms so gestures never queue React re-renders per frame.
  const lastSentScale = useSharedValue(1.0);
  const lastSentTx = useSharedValue(0.0);
  const lastSentTy = useSharedValue(0.0);
  const lastSentAt = useSharedValue(0);

  useAnimatedReaction(
    () => [scale.value, translateX.value, translateY.value] as const,
    ([s, tx, ty]) => {
      const scaleDiff = Math.abs(s - lastSentScale.value);
      const dx = tx - lastSentTx.value;
      const dy = ty - lastSentTy.value;
      const distDiff = Math.sqrt(dx * dx + dy * dy);
      if (scaleDiff <= 0.05 && distDiff <= 64.0) return;

      const now = Date.now();
      if (now - lastSentAt.value < 100) return;

      lastSentAt.value = now;
      lastSentScale.value = s;
      lastSentTx.value = tx;
      lastSentTy.value = ty;
      runOnJS(handleViewportChange)(s, tx, ty);
    },
    [handleViewportChange]
  );

  // Paint objects used inside recordings
  const minorGridPaint = useMemo(() => {
    const p = Skia.Paint();
    p.setColor(Skia.Color(theme.minorGridColor));
    p.setStyle(PaintStyle.Stroke);
    p.setStrokeWidth(0.5);
    return p;
  }, [theme.minorGridColor]);

  const majorGridPaint = useMemo(() => {
    const p = Skia.Paint();
    p.setColor(Skia.Color(theme.majorGridColor));
    p.setStyle(PaintStyle.Stroke);
    p.setStrokeWidth(1.0);
    return p;
  }, [theme.majorGridColor]);

  const previewPaint = useMemo(() => {
    const p = Skia.Paint();
    p.setStyle(PaintStyle.Fill);
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
    p.setColor(Skia.Color(theme.celebrationAccent));
    p.setStyle(PaintStyle.Stroke);
    p.setStrokeWidth(1.5);
    return p;
  }, [theme.celebrationAccent]);

  // Compute LOD zoom band
  const lodBand = getLodBand(cullViewport.scale);

  // Count re-recordings for dev validation
  let completedReRecords = 0;

  // While the viewport is moving, missing tile pictures are not recorded
  // (blank fabric shows briefly during very fast scroll); dirty tiles from an
  // active Stitch Sweep still re-record so stitches stay within the 50 ms
  // stitch-to-visible budget. Pure pan/zoom dirties nothing, so no recording
  // work runs during those gestures.
  const canRecordMissing = !viewportMoving;

  // Pre-fetch/re-record visible tiles
  const renderedTiles = visibleTiles.map(({ tileX, tileY }) => {
    const baseKey = `${theme.id}_${tileX}_${tileY}_${lodBand}`;
    const completedBaseKey = `${theme.id}_${tileX}_${tileY}`;
    const completedVariant = lodBand;
    const completedKey = `${completedBaseKey}_${completedVariant}`;
    const overlayKey = `${theme.id}_${tileX}_${tileY}`;

    // --- 1. Base Picture (Immutable per LOD band) ---
    let basePic = baseCache.current.get(baseKey);
    if (!basePic && canRecordMissing) {
      const recorder = Skia.PictureRecorder();
      const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, TILE_SIZE, TILE_SIZE));

      // Draw faded mosaic pattern preview for zoomed-out (out) and medium (mid) LODs
      if (lodBand === 'out' || lodBand === 'mid') {
        const previewOpacity = lodBand === 'out' ? 0.35 : 0.25;
        for (let cy = 0; cy < TILE_CELLS; cy++) {
          for (let cx = 0; cx < TILE_CELLS; cx++) {
            const gx = tileX * TILE_CELLS + cx;
            const gy = tileY * TILE_CELLS + cy;

            if (gx < pattern.width && gy < pattern.height) {
              const colorIdx = pattern.grid[gy * pattern.width + gx];
              if (colorIdx > 0) {
                const colorHex = pattern.palette[colorIdx - 1].rgbHex;
                const col = Skia.Color(colorHex);
                col[3] = previewOpacity;
                previewPaint.setColor(col);
                canvas.drawRect(
                  Skia.XYWHRect(cx * CELL_SIZE, cy * CELL_SIZE, CELL_SIZE, CELL_SIZE),
                  previewPaint
                );
              }
            }
          }
        }
      }

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
    if (isCompletedDirty) {
      completedCache.current.delete(`${completedBaseKey}_out`);
      completedCache.current.delete(`${completedBaseKey}_mid`);
      completedCache.current.delete(`${completedBaseKey}_readable`);
    }
    let completedPic = completedCache.current.get(completedKey);

    if (isCompletedDirty || (!completedPic && canRecordMissing)) {
      completedReRecords++;
      const recorder = Skia.PictureRecorder();
      const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, TILE_SIZE, TILE_SIZE));

      for (let cy = 0; cy < TILE_CELLS; cy++) {
        for (let cx = 0; cx < TILE_CELLS; cx++) {
          const gx = tileX * TILE_CELLS + cx;
          const gy = tileY * TILE_CELLS + cy;

          if (gx < pattern.width && gy < pattern.height) {
            const cellIndex = gy * pattern.width + gx;
            const isDynamic = rendererState.isCompletedStitchDynamic(gx, gy, lodBand);
            if (rendererState.isCompleted(gx, gy) || isDynamic) {
              const colorIdx = pattern.grid[gy * pattern.width + gx];
              if (colorIdx > 0) {
                const colorHex = pattern.palette[colorIdx - 1].rgbHex;
                const decision = rendererState.getCompletedStitchVisualDecision(
                  cellIndex,
                  lodBand,
                  colorHex,
                  theme.threadFinish,
                  visualNow,
                );
                const left = cx * CELL_SIZE;
                const top = cy * CELL_SIZE;
                if (!decision.showThreadNumber) {
                  stitchPaint.setStyle(PaintStyle.Fill);
                  stitchPaint.setColor(Skia.Color(theme.gridBackground));
                  canvas.drawRect(
                    Skia.XYWHRect(left + 0.6, top + 0.6, CELL_SIZE - 1.2, CELL_SIZE - 1.2),
                    stitchPaint,
                  );
                }
                if (decision.isDynamic) continue;

                if (decision.representation === 'mosaic') {
                  stitchPaint.setStyle(PaintStyle.Fill);
                  stitchPaint.setColor(Skia.Color(decision.dmcColor));
                  canvas.drawRect(
                    Skia.XYWHRect(left, top, CELL_SIZE, CELL_SIZE),
                    stitchPaint,
                  );
                } else {
                  // One cross geometry and overlap order applies to every theme.
                  // Grid pictures are drawn underneath this layer, preserving the
                  // fabric margin and preventing lines crossing the thread.
                  stitchPaint.setStyle(PaintStyle.Stroke);
                  const threadWidth = decision.representation === 'textured-cross' ? 3.1 : 2.5;
                  const surface = deriveThreadSurfaceColors(decision.dmcColor, decision.finish);
                  stitchPaint.setStrokeWidth(threadWidth + 0.8);
                  stitchPaint.setColor(Skia.Color(surface.shadow));
                  canvas.drawLine(left + 2.5, top + CELL_SIZE - 2.5, left + CELL_SIZE - 2.5, top + 2.5, stitchPaint);
                  stitchPaint.setStrokeWidth(threadWidth);
                  stitchPaint.setColor(Skia.Color(surface.base));
                  canvas.drawLine(left + 2.5, top + CELL_SIZE - 2.5, left + CELL_SIZE - 2.5, top + 2.5, stitchPaint);
                  stitchPaint.setStrokeWidth(threadWidth);
                  stitchPaint.setColor(Skia.Color(surface.base));
                  canvas.drawLine(left + 2.5, top + 2.5, left + CELL_SIZE - 2.5, top + CELL_SIZE - 2.5, stitchPaint);
                  if (decision.representation === 'textured-cross') {
                    stitchPaint.setStrokeWidth(0.7);
                    stitchPaint.setColor(Skia.Color(surface.highlight));
                    canvas.drawLine(left + 3.4, top + 3.0, left + CELL_SIZE - 3.0, top + CELL_SIZE - 3.4, stitchPaint);
                  }
                }
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

    if (isOverlayDirty || (!overlayPic && canRecordMissing)) {
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

  // --- 4. Bounded Cache Eviction (LRU) ---
  // Prune least-recently-used tiles beyond the budget once the viewport
  // settles; visible tiles are never evicted, and recently visited off-screen
  // tiles stay warm so scrolling back does not thrash re-recording.
  useEffect(() => {
    if (viewportMoving) return;

    const visibleKeys = new Set(
      visibleTiles.map((t) => `${theme.id}_${t.tileX}_${t.tileY}`),
    );
    const completedVisibleKeys = new Set(
      visibleTiles.map(
        (t) => `${theme.id}_${t.tileX}_${t.tileY}_${lodBand}`,
      ),
    );
    completedCache.current.prune(completedVisibleKeys, TILE_CACHE_BUDGET);
    overlayCache.current.prune(visibleKeys, TILE_CACHE_BUDGET);

    const baseVisibleKeys = new Set(
      visibleTiles.map((t) => `${theme.id}_${t.tileX}_${t.tileY}_${lodBand}`)
    );
    baseCache.current.prune(baseVisibleKeys, TILE_CACHE_BUDGET);
  }, [visibleTiles, lodBand, viewportMoving, theme.id]);

  // Setup dynamic transform array for Reanimated/Skia
  const skiaTransform = useDerivedValue(() => [
    { translateX: translateX.value },
    { translateY: translateY.value },
    { scale: scale.value },
  ]);
  const visibleTileKeys = new Set(visibleTiles.map(({ tileX, tileY }) => `${tileX}_${tileY}`));
  const dynamicStitches = rendererState.getActiveCompletedStitchIndexes(lodBand)
    .map((cellIndex) => {
      const x = cellIndex % pattern.width;
      const y = Math.floor(cellIndex / pattern.width);
      const tileKey = `${Math.floor(x / TILE_CELLS)}_${Math.floor(y / TILE_CELLS)}`;
      if (!visibleTileKeys.has(tileKey)) return null;
      const colorIndex = pattern.grid[cellIndex];
      if (colorIndex <= 0) return null;
      const decision = rendererState.getCompletedStitchVisualDecision(
        cellIndex,
        lodBand,
        pattern.palette[colorIndex - 1].rgbHex,
        theme.threadFinish,
        visualNow,
      );
      return { cellIndex, x, y, decision };
    })
    .filter((stitch): stitch is NonNullable<typeof stitch> => stitch !== null);

  return (
    <View
      style={[styles.container, { backgroundColor: theme.gridBackground }]}
      onLayout={handleLayout}
    >
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
            {dynamicStitches.map(({ cellIndex, x, y, decision }) => {
              const left = x * CELL_SIZE;
              const top = y * CELL_SIZE;
              const centerX = left + CELL_SIZE / 2;
              const centerY = top + CELL_SIZE / 2;
              const inset = 2.5;
              const radius = CELL_SIZE / 2 - inset;
              const lowerProgress = decision.lowerStrandProgress;
              const upperProgress = decision.upperStrandProgress;
              const lowerStart = vec(centerX - radius * lowerProgress, centerY + radius * lowerProgress);
              const lowerEnd = vec(centerX + radius * lowerProgress, centerY - radius * lowerProgress);
              const upperStart = vec(centerX - radius * upperProgress, centerY - radius * upperProgress);
              const upperEnd = vec(centerX + radius * upperProgress, centerY + radius * upperProgress);
              const surface = deriveThreadSurfaceColors(decision.dmcColor, decision.finish);
              const threadWidth = decision.representation === 'textured-cross' ? 3.1 : 2.5;
              return (
                <Group key={`dynamic-${cellIndex}`}>
                  <Rect x={left + 0.6} y={top + 0.6} width={CELL_SIZE - 1.2} height={CELL_SIZE - 1.2} color={theme.gridBackground} />
                  <Line p1={lowerStart} p2={lowerEnd} color={surface.shadow} style="stroke" strokeWidth={threadWidth + 0.8} />
                  <Line p1={lowerStart} p2={lowerEnd} color={surface.base} style="stroke" strokeWidth={threadWidth} />
                  <Line p1={upperStart} p2={upperEnd} color={surface.base} style="stroke" strokeWidth={threadWidth} />
                  {decision.representation === 'textured-cross' && (
                    <Line p1={upperStart} p2={upperEnd} color={surface.highlight} style="stroke" strokeWidth={0.7} />
                  )}
                </Group>
              );
            })}
          </Group>
        </Canvas>
      </GestureDetector>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  canvas: {
    flex: 1,
  },
});
