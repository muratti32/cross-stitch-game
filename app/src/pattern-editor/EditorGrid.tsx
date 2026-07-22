import React, { useMemo } from 'react';
import { View, StyleSheet, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  useSharedValue,
  useDerivedValue,
  cancelAnimation,
  withDecay,
  runOnJS,
  clamp,
} from 'react-native-reanimated';
import { Canvas, Group, Picture, Skia } from '@shopify/react-native-skia';
import { CELL_SIZE } from '@/renderer/tileMath';

export interface EditorGridProps {
  width: number;
  height: number;
  palette: { dmcCode: string; name: string; rgbHex: string }[];
  grid: Uint8Array;
  onCellTap: (cellIndex: number) => void;
}

export function EditorGrid({ width, height, palette, grid, onCellTap }: EditorGridProps) {
  const containerWidth = useSharedValue(0);
  const containerHeight = useSharedValue(0);

  const scale = useSharedValue(1.0);
  const translateX = useSharedValue(0.0);
  const translateY = useSharedValue(0.0);
  const minScale = useSharedValue(0.05);
  const maxScale = 8.0;

  const clampTranslations = (currentScale: number) => {
    'worklet';
    const cW = containerWidth.value;
    const cH = containerHeight.value;
    const contentW = width * CELL_SIZE * currentScale;
    const contentH = height * CELL_SIZE * currentScale;

    if (contentW <= cW) {
      translateX.value = (cW - contentW) / 2;
    } else {
      translateX.value = clamp(translateX.value, cW - contentW, 0);
    }

    if (contentH <= cH) {
      translateY.value = (cH - contentH) / 2;
    } else {
      translateY.value = clamp(translateY.value, cH - contentH, 0);
    }
  };

  const fitToScreen = (cW: number, cH: number) => {
    'worklet';
    const pW = width * CELL_SIZE;
    const pH = height * CELL_SIZE;
    if (cW <= 0 || cH <= 0 || pW <= 0 || pH <= 0) return;

    const fitScale = Math.min(cW / pW, cH / pH);
    minScale.value = fitScale;

    scale.value = fitScale;
    translateX.value = (cW - pW * fitScale) / 2;
    translateY.value = (cH - pH * fitScale) / 2;
  };

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width: w, height: h } = event.nativeEvent.layout;
    const isFirstTime = containerWidth.value === 0 && containerHeight.value === 0;
    containerWidth.value = w;
    containerHeight.value = h;
    if (isFirstTime) {
      fitToScreen(w, h);
    }
  };

  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      cancelAnimation(scale);
      cancelAnimation(translateX);
      cancelAnimation(translateY);
    })
    .onChange((event) => {
      const prevScale = scale.value;
      const s = clamp(prevScale * event.scaleChange, minScale.value, maxScale);
      const applied = s / prevScale;

      translateX.value = event.focalX - (event.focalX - translateX.value) * applied;
      translateY.value = event.focalY - (event.focalY - translateY.value) * applied;
      scale.value = s;

      clampTranslations(s);
    });

  const panGesture = Gesture.Pan()
    .onStart(() => {
      cancelAnimation(translateX);
      cancelAnimation(translateY);
    })
    .onChange((event) => {
      translateX.value += event.changeX;
      translateY.value += event.changeY;
      clampTranslations(scale.value);
    })
    .onEnd((event) => {
      const cW = containerWidth.value;
      const cH = containerHeight.value;
      const contentW = width * CELL_SIZE * scale.value;
      const contentH = height * CELL_SIZE * scale.value;

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
      const patX = (event.x - translateX.value) / curScale;
      const patY = (event.y - translateY.value) / curScale;

      const cellX = Math.floor(patX / CELL_SIZE);
      const cellY = Math.floor(patY / CELL_SIZE);

      if (cellX >= 0 && cellX < width && cellY >= 0 && cellY < height) {
        const cellIndex = cellY * width + cellX;
        runOnJS(onCellTap)(cellIndex);
      }
    });

  const gesture = Gesture.Simultaneous(singleTapGesture, pinchGesture, panGesture);

  const picture = useMemo(() => {
    const recorder = Skia.PictureRecorder();
    const canvas = recorder.beginRecording(
      Skia.XYWHRect(0, 0, width * CELL_SIZE, height * CELL_SIZE),
    );
    const paint = Skia.Paint();
    for (let i = 0; i < grid.length; i++) {
      const val = grid[i];
      let colorHex = '#FFFFFF';
      if (val !== 0) {
        const entry = palette[val - 1];
        if (entry) {
          colorHex = entry.rgbHex;
        }
      }
      const c = i % width;
      const r = Math.floor(i / width);
      paint.setColor(Skia.Color(colorHex));
      canvas.drawRect(
        Skia.XYWHRect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE),
        paint,
      );
    }
    return recorder.finishRecordingAsPicture();
  }, [grid, palette, width, height]);

  const skiaTransform = useDerivedValue(() => [
    { translateX: translateX.value },
    { translateY: translateY.value },
    { scale: scale.value },
  ]);

  return (
    <View style={styles.container} onLayout={handleLayout}>
      <GestureDetector gesture={gesture}>
        <Canvas style={styles.canvas}>
          <Group transform={skiaTransform}>
            {picture && <Picture picture={picture} />}
          </Group>
        </Canvas>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF6F0',
    overflow: 'hidden',
  },
  canvas: {
    flex: 1,
  },
});
