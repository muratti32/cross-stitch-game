import { useCallback } from 'react';
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
import { CELL_SIZE, computeEdgePanVelocity } from './tileMath';

export interface UseRendererGestureOptions {
  patternWidth: number;
  patternHeight: number;
  maxScale?: number;
  onCellTapped?: (x: number, y: number) => void;
  onSweepStitch?: (x: number, y: number) => void;
  gridShared: SharedValue<Uint8Array>;
  completedShared: SharedValue<Uint8Array>;
  activeColorIndexShared: SharedValue<number>;
  isColorCompletedShared: SharedValue<boolean>;
}

export function useRendererGesture({
  patternWidth,
  patternHeight,
  maxScale = 3.0, // e.g. 48px per cell (48 / 16 = 3.0)
  onCellTapped,
  onSweepStitch,
  gridShared,
  completedShared,
  activeColorIndexShared,
  isColorCompletedShared,
}: UseRendererGestureOptions) {
  // Container (viewport) dimensions
  const containerWidth = useSharedValue(0);
  const containerHeight = useSharedValue(0);

  // Current transform shared values
  const scale = useSharedValue(1.0);
  const translateX = useSharedValue(0.0);
  const translateY = useSharedValue(0.0);

  // Clamping scale limit derived dynamically based on fit
  const minScale = useSharedValue(0.05);

  // Saved transform values for gesture relative offsets
  const savedScale = useSharedValue(1.0);
  const savedTranslateX = useSharedValue(0.0);
  const savedTranslateY = useSharedValue(0.0);

  // Sweep gesture state tracking
  const isSweepActive = useSharedValue(false);
  const fingerX = useSharedValue(0.0);
  const fingerY = useSharedValue(0.0);
  const lastStitchedX = useSharedValue(-1);
  const lastStitchedY = useSharedValue(-1);

  // Helper worklet to clamp translations so content doesn't fly off screen
  const clampTranslations = (currentScale: number) => {
    'worklet';
    const cW = containerWidth.value;
    const cH = containerHeight.value;
    const contentW = patternWidth * CELL_SIZE * currentScale;
    const contentH = patternHeight * CELL_SIZE * currentScale;

    // Centered horizontally if fits, otherwise clamped to boundaries
    if (contentW <= cW) {
      translateX.value = (cW - contentW) / 2;
    } else {
      translateX.value = clamp(translateX.value, cW - contentW, 0);
    }

    // Centered vertically if fits, otherwise clamped to boundaries
    if (contentH <= cH) {
      translateY.value = (cH - contentH) / 2;
    } else {
      translateY.value = clamp(translateY.value, cH - contentH, 0);
    }
  };

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
              runOnJS(onSweepStitch)(cellX, cellY);
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

    if (contentW <= cW) {
      targetTx = (cW - contentW) / 2;
    } else {
      targetTx = Math.min(0, Math.max(cW - contentW, targetTx));
    }

    if (contentH <= cH) {
      targetTy = (cH - contentH) / 2;
    } else {
      targetTy = Math.min(0, Math.max(cH - contentH, targetTy));
    }

    cancelAnimation(scale);
    cancelAnimation(translateX);
    cancelAnimation(translateY);

    scale.value = withTiming(targetScale, { duration: 300 });
    translateX.value = withTiming(targetTx, { duration: 300 });
    translateY.value = withTiming(targetTy, { duration: 300 });
  }, [patternWidth, containerWidth, containerHeight, scale, translateX, translateY]);

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
      }
    },
    [containerWidth, containerHeight, fitToScreen]
  );

  // Gesture definitions
  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      cancelAnimation(scale);
      cancelAnimation(translateX);
      cancelAnimation(translateY);
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((event) => {
      const s = clamp(savedScale.value * event.scale, minScale.value, maxScale);
      scale.value = s;

      // Focal-anchored zoom math:
      // screen_pos = focal_pos = pattern_pos * scale + translate
      // => newTx = focalX - (focalX - savedTx) * (s / savedScale)
      translateX.value =
        event.focalX - (event.focalX - savedTranslateX.value) * (s / savedScale.value);
      translateY.value =
        event.focalY - (event.focalY - savedTranslateY.value) * (s / savedScale.value);

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
            isSweepActive.value = true;
            fingerX.value = event.x;
            fingerY.value = event.y;
            lastStitchedX.value = cellX;
            lastStitchedY.value = cellY;
            if (onSweepStitch) {
              runOnJS(onSweepStitch)(cellX, cellY);
            }
            return;
          }
        }
      }
      isSweepActive.value = false;
      lastStitchedX.value = -1;
      lastStitchedY.value = -1;
    })
    .onStart(() => {
      if (isSweepActive.value) return;
      cancelAnimation(translateX);
      cancelAnimation(translateY);
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((event) => {
      fingerX.value = event.x;
      fingerY.value = event.y;

      if (isSweepActive.value) {
        if (isColorCompletedShared.value) {
          isSweepActive.value = false;
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
                runOnJS(onSweepStitch)(cellX, cellY);
              }
            }
          }
        }
      } else {
        translateX.value = savedTranslateX.value + event.translationX;
        translateY.value = savedTranslateY.value + event.translationY;
        clampTranslations(scale.value);
      }
    })
    .onEnd((event) => {
      if (isSweepActive.value) {
        isSweepActive.value = false;
        lastStitchedX.value = -1;
        lastStitchedY.value = -1;
        return;
      }

      const cW = containerWidth.value;
      const cH = containerHeight.value;
      const contentW = patternWidth * CELL_SIZE * scale.value;
      const contentH = patternHeight * CELL_SIZE * scale.value;

      // Pan bounds for momentum decay
      const minTx = contentW <= cW ? (cW - contentW) / 2 : cW - contentW;
      const maxTx = contentW <= cW ? (cW - contentW) / 2 : 0;
      const minTy = contentH <= cH ? (cH - contentH) / 2 : cH - contentH;
      const maxTy = contentH <= cH ? (cH - contentH) / 2 : 0;

      translateX.value = withDecay({
        velocity: event.velocityX,
        clamp: [minTx, maxTx],
      });
      translateY.value = withDecay({
        velocity: event.velocityY,
        clamp: [minTy, maxTy],
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
