import { useCallback } from 'react';
import {
  useSharedValue,
  withTiming,
  withDecay,
  cancelAnimation,
  runOnJS,
  clamp,
} from 'react-native-reanimated';
import { Gesture } from 'react-native-gesture-handler';
import { CELL_SIZE } from './tileMath';

export interface UseRendererGestureOptions {
  patternWidth: number;
  patternHeight: number;
  maxScale?: number;
  onCellTapped?: (x: number, y: number) => void;
}

export function useRendererGesture({
  patternWidth,
  patternHeight,
  maxScale = 3.0, // e.g. 48px per cell (48 / 16 = 3.0)
  onCellTapped,
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
    .onStart(() => {
      cancelAnimation(translateX);
      cancelAnimation(translateY);
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((event) => {
      translateX.value = savedTranslateX.value + event.translationX;
      translateY.value = savedTranslateY.value + event.translationY;
      clampTranslations(scale.value);
    })
    .onEnd((event) => {
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
  };
}
