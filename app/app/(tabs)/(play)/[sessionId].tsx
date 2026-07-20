import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text, ActivityIndicator, Pressable, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter, useNavigation, useFocusEffect } from 'expo-router';
import { Screen, Button } from '@/components';
import { Theme } from '@/theme/theme';
import { createReplaySession } from '@/local-db';
import { StitchRenderer, type StitchRendererRef, nextRemainingCell } from '@/renderer';
import { useGameplayStore } from '@/store/gameplayStore';
import { useStitchingSession } from '@/hooks/useStitchingSession';
import { Ionicons } from '@expo/vector-icons';
import { BUNDLED_PATTERNS } from '@/bundled-patterns';
import * as Haptics from 'expo-haptics';
import Animated, { useSharedValue, useAnimatedStyle, withSequence, withTiming } from 'react-native-reanimated';

export default function SessionReadyScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const navigation = useNavigation();

  // Hide the OS bottom tab bar while a stitching session is focused, so a
  // finger drifting past the thread palette can't land on another app tab
  // and bounce the user out of the session mid-stitch.
  useFocusEffect(
    React.useCallback(() => {
      const parentTabs = navigation.getParent();
      parentTabs?.setOptions({ tabBarStyle: { display: 'none' } });
      return () => {
        parentTabs?.setOptions({ tabBarStyle: undefined });
      };
    }, [navigation])
  );

  const {
    loading,
    error,
    session,
    patternData,
    rendererState,
    remainingCounts,
    isSessionCompleted,
    canUndo,
    totalCellsCount,
    completedCellsCount,
    stitchCell,
    undo,
    hasSyncConflict,
    dismissSyncConflict,
    syncTick,
  } = useStitchingSession(sessionId);

  const { selectedColorIndex, setSelectedColorIndex, handedness } = useGameplayStore();
  const initialSelectionDone = useRef(false);

  // Parent revision to trigger canvas updates from parent events
  const [parentRevision, setParentRevision] = useState(0);

  // Shared values to bridge UI thread gesture layer with state
  const gridShared = useSharedValue<Uint8Array>(new Uint8Array(0));
  const completedShared = useSharedValue<Uint8Array>(new Uint8Array(0));
  const activeColorIndexShared = useSharedValue<number>(0);
  const isColorCompletedShared = useSharedValue<boolean>(false);

  const rendererRef = useRef<StitchRendererRef>(null);
  const lastLocatedIndex = useRef<number>(-1);

  // Animation values for mismatch shake feedback
  const shakeOffset = useSharedValue(0);
  const animatedShakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeOffset.value }],
  }));

  // Sync Shared Values on data load or change
  useEffect(() => {
    if (patternData && rendererState) {
      gridShared.value = patternData.grid;
      completedShared.value = rendererState.getCompletedArray();
    }
  }, [patternData, rendererState]);

  // Refresh the canvas when a Progress Sync folds in server-changed cells.
  useEffect(() => {
    if (syncTick > 0 && rendererState) {
      completedShared.value = rendererState.getCompletedArray();
      setParentRevision((revision) => revision + 1);
    }
  }, [syncTick, rendererState]);

  useEffect(() => {
    activeColorIndexShared.value = selectedColorIndex;
    lastLocatedIndex.current = -1;
  }, [selectedColorIndex]);

  useEffect(() => {
    if (remainingCounts.length > 0) {
      isColorCompletedShared.value = remainingCounts[selectedColorIndex] === 0;
    }
  }, [remainingCounts, selectedColorIndex]);

  // Auto-select the first incomplete color on load (once)
  useEffect(() => {
    if (!loading && remainingCounts.length > 0 && !initialSelectionDone.current) {
      initialSelectionDone.current = true;
      const firstIncompleteIdx = remainingCounts.findIndex((count) => count > 0);
      if (firstIncompleteIdx !== -1) {
        setSelectedColorIndex(firstIncompleteIdx);
      }
    }
  }, [loading, remainingCounts, setSelectedColorIndex]);

  // Handle cell taps
  const handleCellTapped = (x: number, y: number) => {
    if (isSessionCompleted) return; // Read-only

    const success = stitchCell(x, y, selectedColorIndex);
    if (success) {
      if (patternData) {
        const idx = y * patternData.width + x;
        completedShared.value[idx] = 1;
        completedShared.value = Uint8Array.from(completedShared.value);
      }
      setParentRevision((r) => r + 1);
    } else {
      // Trigger haptic feedback + visual shake
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      shakeOffset.value = 0;
      shakeOffset.value = withSequence(
        withTiming(-8, { duration: 40 }),
        withTiming(8, { duration: 40 }),
        withTiming(-8, { duration: 40 }),
        withTiming(8, { duration: 40 }),
        withTiming(0, { duration: 40 })
      );
    }
  };

  // Handle sweep stitch events
  const handleSweepStitch = (x: number, y: number) => {
    if (isSessionCompleted) return;
    const success = stitchCell(x, y, selectedColorIndex);
    if (success && patternData) {
      const idx = y * patternData.width + x;
      completedShared.value[idx] = 1;
      completedShared.value = Uint8Array.from(completedShared.value);
      setParentRevision((r) => r + 1);
    }
  };

  // Handle undo action
  const handleUndo = () => {
    if (canUndo) {
      const success = undo();
      if (success && rendererState) {
        completedShared.value = Uint8Array.from(rendererState.getCompletedArray());
        setParentRevision((r) => r + 1);
      }
    }
  };

  // Handle locator cell navigation
  const handleLocateNext = () => {
    if (!patternData || !rendererState) return;

    const completed = rendererState.getCompletedArray();
    const nextIdx = nextRemainingCell(
      patternData.grid,
      completed,
      patternData.width,
      patternData.height,
      selectedColorIndex,
      lastLocatedIndex.current
    );

    if (nextIdx !== null) {
      const cx = nextIdx % patternData.width;
      const cy = Math.floor(nextIdx / patternData.width);

      lastLocatedIndex.current = nextIdx;
      rendererState.focusCell(cx, cy);
      setParentRevision((r) => r + 1);

      if (rendererRef.current) {
        rendererRef.current.locateCell(cx, cy);
      }
    }
  };

  // Replay option when complete
  const handleReplay = async () => {
    if (!session) return;
    try {
      const newSession = await createReplaySession(session.id);
      router.replace(`/(tabs)/(play)/${newSession.id}`);
    } catch (err) {
      console.error('Failed to create replay session:', err);
    }
  };

  if (loading) {
    return (
      <Screen style={styles.loaderContainer}>
        <ActivityIndicator size="large" color={Theme.colors.accentTeal} />
        <Text style={styles.loadingText} allowFontScaling={true}>
          Opening session & preparing fabric...
        </Text>
      </Screen>
    );
  }

  if (error || !session || !patternData || !rendererState) {
    return (
      <Screen style={styles.errorContainer}>
        <Text style={styles.errorTitle} allowFontScaling={true}>
          Session Load Failed
        </Text>
        <Text style={styles.errorText} allowFontScaling={true}>
          {error || 'Unable to load your stitching session.'}
        </Text>
        <View style={styles.errorActions}>
          <Button
            title="Go to Table"
            onPress={() => router.dismissTo('/(tabs)/(play)')}
            variant="secondary"
            style={styles.errorBtn}
          />
        </View>
      </Screen>
    );
  }

  const percentComplete = totalCellsCount > 0 
    ? Math.floor((completedCellsCount / totalCellsCount) * 100) 
    : 0;

  const selectedColor = patternData.palette[selectedColorIndex];
  
  const bPattern = patternData && session
    ? BUNDLED_PATTERNS.find((p) => p.id === session.patternId)
    : null;
  const patternTitle = bPattern?.title || session.title || 'Stitch Session';

  return (
    <Screen style={styles.fullscreenContainer} edges={['top', 'left', 'right', 'bottom']}>
      {/* Progress Header Bar */}
      <View style={styles.header}>
        <Button
          variant="secondary"
          title="← Table"
          onPress={() => router.dismissTo('/(tabs)/(play)')}
          style={styles.backButton}
        />
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle} numberOfLines={1} allowFontScaling={true}>
            {patternTitle}
          </Text>
          <Text style={styles.headerSubtitle} allowFontScaling={true}>
            {completedCellsCount} / {totalCellsCount} cells ({percentComplete}% complete)
          </Text>
        </View>
      </View>

      {/* Progress Sync conflict notice (server resolved a concurrent edit) */}
      {hasSyncConflict && (
        <Pressable style={styles.conflictBanner} onPress={dismissSyncConflict}>
          <Ionicons name="sync-outline" size={16} color={Theme.colors.textPrimary} />
          <Text style={styles.conflictText}>
            Synced with another device — some cells were updated. Tap to dismiss.
          </Text>
        </Pressable>
      )}

      {/* Skia Canvas Container */}
      <Animated.View style={[styles.canvasWrapper, animatedShakeStyle]}>
        <StitchRenderer
          ref={rendererRef}
          pattern={patternData}
          rendererState={rendererState}
          onCellTapped={handleCellTapped}
          onSweepStitch={handleSweepStitch}
          gridShared={gridShared}
          completedShared={completedShared}
          activeColorIndexShared={activeColorIndexShared}
          isColorCompletedShared={isColorCompletedShared}
          parentRevision={parentRevision}
        />
      </Animated.View>

      {/* Floating Tool Rail */}
      {!isSessionCompleted && (
        <View
          style={[
            styles.floatingRail,
            handedness === 'left' ? styles.floatingRailLeft : styles.floatingRailRight,
          ]}
        >
          {/* Remaining Cell Locator Button */}
          <Pressable
            style={[
              styles.floatingButton,
              remainingCounts[selectedColorIndex] === 0 && styles.floatingButtonDisabled,
            ]}
            onPress={handleLocateNext}
            disabled={remainingCounts[selectedColorIndex] === 0}
            accessibilityRole="button"
            accessibilityLabel="Locate next remaining cell of active thread color"
          >
            <Ionicons
              name="locate-outline"
              size={24}
              color={
                remainingCounts[selectedColorIndex] > 0
                  ? Theme.colors.textPrimary
                  : Theme.colors.disabledText
              }
            />
          </Pressable>

          {/* Undo Button */}
          <Pressable
            style={[styles.floatingButton, !canUndo && styles.floatingButtonDisabled]}
            onPress={handleUndo}
            disabled={!canUndo}
            accessibilityRole="button"
            accessibilityLabel="Undo last stitch"
          >
            <Ionicons
              name="arrow-undo-outline"
              size={24}
              color={canUndo ? Theme.colors.textPrimary : Theme.colors.disabledText}
            />
          </Pressable>
        </View>
      )}

      {/* Bottom Thread Palette dock */}
      {!isSessionCompleted && (
        <View style={styles.paletteDock}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[
              styles.paletteScrollContent,
              {
                flexDirection: handedness === 'left' ? 'row' : 'row-reverse',
                justifyContent: handedness === 'left' ? 'flex-start' : 'flex-end',
              },
            ]}
          >
            {patternData.palette.map((color, index) => {
              const isSelected = index === selectedColorIndex;
              const remaining = remainingCounts[index] ?? 0;
              const isCompleted = remaining === 0;

              return (
                <Pressable
                  key={index}
                  onPress={() => setSelectedColorIndex(index)}
                  style={[
                    styles.paletteChip,
                    isSelected && styles.paletteChipSelected,
                    isCompleted && styles.paletteChipCompleted,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Color ${index + 1}: DMC ${color.dmcCode}, ${remaining} stitches remaining`}
                >
                  <View style={[styles.chipSwatch, { backgroundColor: color.rgbHex }]}>
                    {isCompleted && (
                      <Ionicons name="checkmark" size={14} color="#FFF" />
                    )}
                  </View>
                  <View style={styles.chipInfo}>
                    <Text style={styles.chipNumber} allowFontScaling={true}>
                      #{index + 1}
                    </Text>
                    <Text style={styles.chipCount} allowFontScaling={true}>
                      {isCompleted ? 'Done' : `${remaining} left`}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Designed Celebration Moment Overlay */}
      {isSessionCompleted && (
        <View style={styles.celebrationOverlay}>
          <View style={styles.celebrationCard}>
            <View style={styles.celebrationBadge}>
              <Ionicons name="sparkles" size={40} color={Theme.colors.accentSage} />
            </View>
            <Text style={styles.celebrationTitle} allowFontScaling={true}>
              Beautifully Crafted!
            </Text>
            <Text style={styles.celebrationSubtitle} allowFontScaling={true}>
              You have completed every single stitch on this fabric.
            </Text>
            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={styles.statVal}>{totalCellsCount}</Text>
                <Text style={styles.statLbl}>Stitches</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={styles.statVal}>{patternData.palette.length}</Text>
                <Text style={styles.statLbl}>Colors</Text>
              </View>
            </View>
            <View style={styles.celebrationActions}>
              <Button
                title="Stitch Again"
                onPress={handleReplay}
                variant="sage"
                style={styles.celebrationBtn}
              />
              <Button
                title="Back to Catalog"
                onPress={() => router.navigate('/(tabs)/(catalog)')}
                variant="secondary"
                style={styles.celebrationBtn}
              />
            </View>
          </View>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: Theme.spacing.md,
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Theme.spacing.xl,
  },
  errorTitle: {
    fontSize: Theme.typography.sizes.xl,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.error,
    marginBottom: Theme.spacing.sm,
  },
  errorText: {
    fontSize: Theme.typography.sizes.md,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: Theme.spacing.xl,
  },
  errorActions: {
    flexDirection: 'row',
    gap: Theme.spacing.md,
  },
  errorBtn: {
    width: 130,
  },
  fullscreenContainer: {
    flex: 1,
    backgroundColor: '#FAF6F0',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    backgroundColor: Theme.colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
    zIndex: 10,
  },
  backButton: {
    height: 36,
    paddingHorizontal: Theme.spacing.sm,
    borderRadius: Theme.radii.md,
    marginRight: Theme.spacing.md,
  },
  conflictBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.xs,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    backgroundColor: '#FBF3E4',
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
    zIndex: 10,
  },
  conflictText: {
    flex: 1,
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textPrimary,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    marginTop: 1,
  },
  canvasWrapper: {
    flex: 1,
    zIndex: 1,
  },
  floatingRail: {
    position: 'absolute',
    bottom: 96,
    gap: Theme.spacing.md,
    zIndex: 20,
  },
  floatingRailRight: {
    right: Theme.spacing.lg,
  },
  floatingRailLeft: {
    left: Theme.spacing.lg,
  },
  floatingButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Theme.colors.card,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Theme.colors.border,
    zIndex: 20,
    // Shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  floatingButtonDisabled: {
    backgroundColor: Theme.colors.disabledBackground,
    borderColor: 'transparent',
    opacity: 0.5,
  },
  paletteDock: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: Theme.colors.card,
    borderTopWidth: 1,
    borderTopColor: Theme.colors.border,
    paddingTop: Theme.spacing.sm,
    paddingBottom: Theme.spacing.lg,
    zIndex: 20,
  },
  paletteScrollContent: {
    paddingHorizontal: Theme.spacing.md,
    gap: Theme.spacing.sm,
    alignItems: 'center',
  },
  paletteChip: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48, // 48pt touch target
    minWidth: 90,
    paddingHorizontal: Theme.spacing.sm,
    borderRadius: 24,
    backgroundColor: Theme.colors.disabledBackground,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  paletteChipSelected: {
    backgroundColor: Theme.colors.card,
    borderColor: Theme.colors.accentSage,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  paletteChipCompleted: {
    opacity: 0.8,
  },
  chipSwatch: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: Theme.spacing.xs,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  chipInfo: {
    justifyContent: 'center',
  },
  chipNumber: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textPrimary,
    lineHeight: 14,
  },
  chipCount: {
    fontSize: 10,
    color: Theme.colors.textSecondary,
    lineHeight: 12,
  },
  celebrationOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(26, 23, 20, 0.45)', // Sleek darkened backing
    justifyContent: 'center',
    alignItems: 'center',
    padding: Theme.spacing.xl,
    zIndex: 100,
  },
  celebrationCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.xl,
    padding: Theme.spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Theme.colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  celebrationBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(122, 154, 130, 0.15)', // Sage transparent
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Theme.spacing.md,
  },
  celebrationTitle: {
    fontSize: Theme.typography.sizes.lg + 2,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
    textAlign: 'center',
    marginBottom: Theme.spacing.xs,
  },
  celebrationSubtitle: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: Theme.spacing.lg,
    paddingHorizontal: Theme.spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-around',
    marginBottom: Theme.spacing.xl,
  },
  statBox: {
    alignItems: 'center',
  },
  statVal: {
    fontSize: Theme.typography.sizes.lg,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.accentSage,
  },
  statLbl: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    marginTop: 2,
  },
  celebrationActions: {
    width: '100%',
    gap: Theme.spacing.md,
  },
  celebrationBtn: {
    width: '100%',
  },
});
