import { useCallback, useEffect } from 'react';
import {
  useSharedValue,
  withTiming,
  withDecay,
  cancelAnimation,
  runOnJS,
  clamp,
  useFrameCallback,
  type SharedValue,
} from 'react-native-reanimated';
import { Gesture } from 'react-native-gesture-handler';
import {
  CELL_SIZE,
  clampTranslation,
  computeEdgePanVelocity,
  translationBounds,
} from './tileMath';

export interface UseRendererGestureOptions {
  patternWidth: number;
  patternHeight: number;
  maxScale?: number;
  panSlack?: { left?: number; right?: number; top?: number; bottom?: number };
  onCellTapped?: (x: number, y: number) => void;
  onSweepStitch?: (x: number, y: number, gestureId: number) => void;
  onPinch?: () => void;
  onPlainDragWithoutStitch?: () => void;
  onEdgeAutoPan?: () => void;
  gridShared: SharedValue<Uint8Array>;
  completedShared: SharedValue<Uint8Array>;
  activeColorIndexShared: SharedValue<number>;
  isColorCompletedShared: SharedValue<boolean>;
  scaleShared?: SharedValue<number>;
  translateXShared?: SharedValue<number>;
  translateYShared?: SharedValue<number>;
  containerWidthShared?: SharedValue<number>;
  containerHeightShared?: SharedValue<number>;
}

export function useRendererGesture({
  patternWidth,
  patternHeight,
  maxScale = 3.0, // e.g. 48px per cell (48 / 16 = 3.0)
  panSlack = {},
  onCellTapped,
  onSweepStitch,
  onPinch,
  onPlainDragWithoutStitch,
  onEdgeAutoPan,
  gridShared,
  completedShared,
  activeColorIndexShared,
  isColorCompletedShared,
  scaleShared,
  translateXShared,
  translateYShared,
  containerWidthShared,
  containerHeightShared,
}: UseRendererGestureOptions) {
  // Shared values are always created so the hook order stays stable; the
  // optional externally-owned values (used by the ADR-0031 performance harness
  // to drive the viewport) simply take precedence when supplied.
  const ownContainerWidth = useSharedValue(0);
  const ownContainerHeight = useSharedValue(0);
  const ownScale = useSharedValue(1.0);
  const ownTranslateX = useSharedValue(0.0);
  const ownTranslateY = useSharedValue(0.0);

  // Container (viewport) dimensions
  const containerWidth = containerWidthShared ?? ownContainerWidth;
  const containerHeight = containerHeightShared ?? ownContainerHeight;

  // Current transform shared values
  const scale = scaleShared ?? ownScale;
  const translateX = translateXShared ?? ownTranslateX;
  const translateY = translateYShared ?? ownTranslateY;

  // Clamping scale limit derived dynamically based on fit
  const minScale = useSharedValue(0.05);

  // Pan slack shared values keep the worklets independent from prop objects.
  const slackLeft = useSharedValue(0);
  const slackRight = useSharedValue(0);
  const slackTop = useSharedValue(0);
  const slackBottom = useSharedValue(0);

  // Sweep gesture state tracking
  const isSweepActive = useSharedValue(false);
  const isSweepCandidate = useSharedValue(false);
  const sweepGestureId = useSharedValue(0);
  const fingerX = useSharedValue(0.0);
  const fingerY = useSharedValue(0.0);
  const sweepStartCellX = useSharedValue(-1);
  const sweepStartCellY = useSharedValue(-1);
  const lastStitchedX = useSharedValue(-1);
  const lastStitchedY = useSharedValue(-1);
  const sweepMovementThreshold = 8;
  const edgeAutoPanObserved = useSharedValue(false);

  // Helper worklet to clamp translations so content doesn't fly off screen
  const clampTranslations = (currentScale: number) => {
    'worklet';
    const cW = containerWidth.value;
    const cH = containerHeight.value;
    const contentW = patternWidth * CELL_SIZE * currentScale;
    const contentH = patternHeight * CELL_SIZE * currentScale;

    translateX.value = clampTranslation(
      translateX.value,
      cW,
      contentW,
      slackLeft.value,
      slackRight.value,
    );
    translateY.value = clampTranslation(
      translateY.value,
      cH,
      contentH,
      slackTop.value,
      slackBottom.value,
    );
  };

  // Publish the slack props to the UI thread, then re-clamp: when the floating
  // rail moves (handedness flip) or disappears, the current translation may sit
  // outside the new bounds and would otherwise stay there until the next pan.
  useEffect(() => {
    slackLeft.value = panSlack.left ?? 0;
    slackRight.value = panSlack.right ?? 0;
    slackTop.value = panSlack.top ?? 0;
    slackBottom.value = panSlack.bottom ?? 0;

    if (containerWidth.value > 0 && containerHeight.value > 0) {
      clampTranslations(scale.value);
    }
  }, [panSlack.bottom, panSlack.left, panSlack.right, panSlack.top]);

  // Edge auto-pan loop
  useFrameCallback((frameInfo) => {
    'worklet';
    if (!isSweepActive.value) return;

    if (isColorCompletedShared.value) {
      isSweepActive.value = false;
      lastStitchedX.value = -1;
      lastStitchedY.value = -1;
      return;
    }

    const timeDiff = frameInfo.timeSincePreviousFrame || 16.6;
    const cW = containerWidth.value;
    const cH = containerHeight.value;
    if (cW <= 0 || cH <= 0) return;

    const margin = 48;
    const maxSpeed = 0.5; // px/ms

    const vx = computeEdgePanVelocity(fingerX.value, cW, margin, maxSpeed);
    const vy = computeEdgePanVelocity(fingerY.value, cH, margin, maxSpeed);

    if (vx !== 0 || vy !== 0) {
      if (!edgeAutoPanObserved.value && onEdgeAutoPan) {
        edgeAutoPanObserved.value = true;
        runOnJS(onEdgeAutoPan)();
      }
      translateX.value = translateX.value + vx * timeDiff;
      translateY.value = translateY.value + vy * timeDiff;
      clampTranslations(scale.value);

      // Check and stitch cell under finger as viewport shifts
      const curScale = scale.value;
      const patX = (fingerX.value - translateX.value) / curScale;
      const patY = (fingerY.value - translateY.value) / curScale;
      const cellX = Math.floor(patX / CELL_SIZE);
      const cellY = Math.floor(patY / CELL_SIZE);

      if (cellX >= 0 && cellX < patternWidth && cellY >= 0 && cellY < patternHeight) {
        const lX = lastStitchedX.value;
        const lY = lastStitchedY.value;

        if (lX !== cellX || lY !== cellY) {
          const idx = cellY * patternWidth + cellX;
          const matchesColor = gridShared.value[idx] === activeColorIndexShared.value + 1;
          const isUnfinished = completedShared.value[idx] === 0;

          if (matchesColor && isUnfinished) {
            lastStitchedX.value = cellX;
            lastStitchedY.value = cellY;
            if (onSweepStitch) {
              runOnJS(onSweepStitch)(cellX, cellY, sweepGestureId.value);
            }
          }
        }
      }
    }
  });

  // Centering & zoom animation on target cell
  const locateCell = useCallback((cx: number, cy: number) => {
    const cW = containerWidth.value;
    const cH = containerHeight.value;
    if (cW <= 0 || cH <= 0) return;

    const readableScale = 14.0 / CELL_SIZE;
    const targetScale = scale.value < readableScale ? readableScale : scale.value;

    const px = (cx + 0.5) * CELL_SIZE;
    const py = (cy + 0.5) * CELL_SIZE;

    let targetTx = cW / 2 - px * targetScale;
    let targetTy = cH / 2 - py * targetScale;

    const contentW = patternWidth * CELL_SIZE * targetScale;
    const contentH = patternHeight * CELL_SIZE * targetScale;

    targetTx = clampTranslation(
      targetTx,
      cW,
      contentW,
      slackLeft.value,
      slackRight.value,
    );
    targetTy = clampTranslation(
      targetTy,
      cH,
      contentH,
      slackTop.value,
      slackBottom.value,
    );

    cancelAnimation(scale);
    cancelAnimation(translateX);
    cancelAnimation(translateY);

    scale.value = withTiming(targetScale, { duration: 300 });
    translateX.value = withTiming(targetTx, { duration: 300 });
    translateY.value = withTiming(targetTy, { duration: 300 });
  }, [
    patternWidth,
    containerWidth,
    containerHeight,
    scale,
    translateX,
    translateY,
    slackBottom,
    slackLeft,
    slackRight,
    slackTop,
  ]);

  // Helper to trigger fit view (called when container size is resolved or manually)
  const fitToScreen = useCallback(() => {
    const cW = containerWidth.value;
    const cH = containerHeight.value;
    const pW = patternWidth * CELL_SIZE;
    const pH = patternHeight * CELL_SIZE;

    if (cW <= 0 || cH <= 0 || pW <= 0 || pH <= 0) return;

    // Compute fit scale
    const fitScale = Math.min(cW / pW, cH / pH);
    minScale.value = fitScale;

    const fitTx = (cW - pW * fitScale) / 2;
    const fitTy = (cH - pH * fitScale) / 2;

    scale.value = fitScale;
    translateX.value = fitTx;
    translateY.value = fitTy;
  }, [patternWidth, patternHeight, containerWidth, containerHeight, minScale, scale, translateX, translateY]);

  // Set container size and trigger fitToScreen if first time
  const setContainerSize = useCallback(
    (w: number, h: number) => {
      const isFirstTime = containerWidth.value === 0 && containerHeight.value === 0;
      containerWidth.value = w;
      containerHeight.value = h;
      if (isFirstTime) {
        fitToScreen();
        return;
      }

      const pW = patternWidth * CELL_SIZE;
      const pH = patternHeight * CELL_SIZE;
      if (w <= 0 || h <= 0 || pW <= 0 || pH <= 0) return;

      const fitScale = Math.min(w / pW, h / pH);
      minScale.value = fitScale;
      if (scale.value < fitScale) {
        scale.value = fitScale;
      }
      clampTranslations(scale.value);
    },
    [
      containerWidth,
      containerHeight,
      fitToScreen,
      minScale,
      patternHeight,
      patternWidth,
      scale,
      clampTranslations,
    ]
  );

  // Gesture definitions.
  // Pinch and pan both apply incremental deltas on top of the current
  // transform, so running simultaneously they compose additively instead of
  // overwriting each other's translation.
  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      if (onPinch) runOnJS(onPinch)();
      cancelAnimation(scale);
      cancelAnimation(translateX);
      cancelAnimation(translateY);
    })
    .onChange((event) => {
      const prevScale = scale.value;
      const s = clamp(prevScale * event.scaleChange, minScale.value, maxScale);
      const applied = s / prevScale;

      // Focal-anchored zoom math (per-update ratio, anchored at current focal):
      // screen_pos = focal_pos = pattern_pos * scale + translate
      // => newTx = focalX - (focalX - currentTx) * applied
      translateX.value = event.focalX - (event.focalX - translateX.value) * applied;
      translateY.value = event.focalY - (event.focalY - translateY.value) * applied;
      scale.value = s;

      clampTranslations(s);
    });

  const panGesture = Gesture.Pan()
    .onBegin((event) => {
      const curScale = scale.value;
      const cellPx = curScale * CELL_SIZE;

      if (cellPx >= 14.0) {
        const patX = (event.x - translateX.value) / curScale;
        const patY = (event.y - translateY.value) / curScale;
        const cellX = Math.floor(patX / CELL_SIZE);
        const cellY = Math.floor(patY / CELL_SIZE);

        if (
          cellX >= 0 &&
          cellX < patternWidth &&
          cellY >= 0 &&
          cellY < patternHeight &&
          !isColorCompletedShared.value
        ) {
          const idx = cellY * patternWidth + cellX;
          const matchesColor = gridShared.value[idx] === activeColorIndexShared.value + 1;
          const isUnfinished = completedShared.value[idx] === 0;

          if (matchesColor && isUnfinished) {
            isSweepCandidate.value = true;
            isSweepActive.value = false;
            fingerX.value = event.x;
            fingerY.value = event.y;
            sweepStartCellX.value = cellX;
            sweepStartCellY.value = cellY;
            lastStitchedX.value = -1;
            lastStitchedY.value = -1;
            return;
          }
        }
      }
      isSweepActive.value = false;
      isSweepCandidate.value = false;
      sweepStartCellX.value = -1;
      sweepStartCellY.value = -1;
      lastStitchedX.value = -1;
      lastStitchedY.value = -1;
    })
    .onStart(() => {
      if (isSweepActive.value) return;
      cancelAnimation(translateX);
      cancelAnimation(translateY);
    })
    .onChange((event) => {
      fingerX.value = event.x;
      fingerY.value = event.y;

      if (!isSweepActive.value && isSweepCandidate.value
        && Math.hypot(event.translationX, event.translationY) >= sweepMovementThreshold) {
        isSweepActive.value = true;
        edgeAutoPanObserved.value = false;
        sweepGestureId.value += 1;
        const startX = sweepStartCellX.value;
        const startY = sweepStartCellY.value;
        lastStitchedX.value = startX;
        lastStitchedY.value = startY;
        if (onSweepStitch) {
          runOnJS(onSweepStitch)(startX, startY, sweepGestureId.value);
        }
      }

      if (isSweepActive.value) {
        if (isColorCompletedShared.value) {
          isSweepActive.value = false;
          isSweepCandidate.value = false;
          sweepStartCellX.value = -1;
          sweepStartCellY.value = -1;
          lastStitchedX.value = -1;
          lastStitchedY.value = -1;
          return;
        }

        // Check cell under current finger
        const curScale = scale.value;
        const patX = (event.x - translateX.value) / curScale;
        const patY = (event.y - translateY.value) / curScale;
        const cellX = Math.floor(patX / CELL_SIZE);
        const cellY = Math.floor(patY / CELL_SIZE);

        if (cellX >= 0 && cellX < patternWidth && cellY >= 0 && cellY < patternHeight) {
          const lX = lastStitchedX.value;
          const lY = lastStitchedY.value;

          if (lX !== cellX || lY !== cellY) {
            const idx = cellY * patternWidth + cellX;
            const matchesColor = gridShared.value[idx] === activeColorIndexShared.value + 1;
            const isUnfinished = completedShared.value[idx] === 0;

            if (matchesColor && isUnfinished) {
              lastStitchedX.value = cellX;
              lastStitchedY.value = cellY;
              if (onSweepStitch) {
                runOnJS(onSweepStitch)(cellX, cellY, sweepGestureId.value);
              }
            }
          }
        }
      } else {
        translateX.value += event.changeX;
        translateY.value += event.changeY;
        clampTranslations(scale.value);
      }
    })
    .onEnd((event) => {
      if (isSweepActive.value) {
        isSweepActive.value = false;
        isSweepCandidate.value = false;
        sweepStartCellX.value = -1;
        sweepStartCellY.value = -1;
        lastStitchedX.value = -1;
        lastStitchedY.value = -1;
        return;
      }

      isSweepCandidate.value = false;
      sweepStartCellX.value = -1;
      sweepStartCellY.value = -1;
      if (onPlainDragWithoutStitch) runOnJS(onPlainDragWithoutStitch)();

      const cW = containerWidth.value;
      const cH = containerHeight.value;
      const contentW = patternWidth * CELL_SIZE * scale.value;
      const contentH = patternHeight * CELL_SIZE * scale.value;

      // Pan bounds for momentum decay
      const xBounds = translationBounds(cW, contentW, slackLeft.value, slackRight.value);
      const yBounds = translationBounds(cH, contentH, slackTop.value, slackBottom.value);

      translateX.value = withDecay({
        velocity: event.velocityX,
        clamp: [xBounds.min, xBounds.max],
      });
      translateY.value = withDecay({
        velocity: event.velocityY,
        clamp: [yBounds.min, yBounds.max],
      });
    });

  const singleTapGesture = Gesture.Tap()
    .numberOfTaps(1)
    .onEnd((event) => {
      const curScale = scale.value;
      const cellPx = curScale * CELL_SIZE;

      // Only allow stitching at cell-readable zoom band
      if (cellPx < 14.0) return;

      const patX = (event.x - translateX.value) / curScale;
      const patY = (event.y - translateY.value) / curScale;

      const cellX = Math.floor(patX / CELL_SIZE);
      const cellY = Math.floor(patY / CELL_SIZE);

      if (cellX >= 0 && cellX < patternWidth && cellY >= 0 && cellY < patternHeight) {
        if (onCellTapped) {
          runOnJS(onCellTapped)(cellX, cellY);
        }
      }
    });

  // Compose all gestures simultaneously so pan/pinch and tap don't delay each other
  const gesture = Gesture.Simultaneous(singleTapGesture, pinchGesture, panGesture);

  return {
    scale,
    translateX,
    translateY,
    minScale,
    gesture,
    setContainerSize,
    fitToScreen,
    locateCell,
  };
}
