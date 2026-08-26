import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Theme } from '../theme/theme';
import type { TutorialEffect } from './tutorialEngine';
import type { HintId } from './justInTimeHints';

type BeatId = Extract<TutorialEffect, { type: 'show_coach_mark' }>['beatId'];

interface Props {
  readonly onSkip?: () => void;
  readonly onDismiss?: () => void;
  readonly beatId?: BeatId;
  readonly hintId?: HintId;
}

const BEAT_COPY: Record<BeatId, string> = {
  thread_palette: 'Select DMC 321 Christmas Red.',
  stitch_action: 'Tap the highlighted matching cell.',
  mismatched_tap: 'Tap the highlighted different cell. Wrong taps cost nothing.',
  undo_action: 'Undo that stitch, then place it again.',
  stitch_sweep: 'Press a matching cell, then drag across the highlighted run.',
};

const HINT_COPY: Record<HintId, string> = {
  anchored_zoom: 'Pinch to zoom while keeping the cells under your fingers in place.',
  pan_vs_sweep: 'Dragging pans the fabric. Start on a matching cell to stitch a sweep.',
  edge_auto_pan: 'Keep sweeping near the edge and the fabric follows your finger.',
  remaining_cell_locator: 'Use the locator to find the next remaining cell for this thread.',
};

export function TutorialCoachBanner({ onSkip, onDismiss, beatId, hintId }: Props) {
  const copy = beatId ? BEAT_COPY[beatId] : HINT_COPY[hintId!];
  return (
    <View style={styles.banner} accessibilityRole="summary" pointerEvents="box-none">
      <Text style={styles.instruction} allowFontScaling>
        {copy}
      </Text>
      {beatId ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Skip tutorial for now" onPress={onSkip} style={styles.skip}>
          <Text style={styles.skipText} allowFontScaling>Skip for now</Text>
        </Pressable>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss hint" onPress={onDismiss} style={styles.skip}>
          <Text style={styles.skipText} allowFontScaling>Got it</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: 'center',
    backgroundColor: Theme.colors.card,
    borderTopColor: Theme.colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: Theme.spacing.sm,
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.xs,
  },
  instruction: {
    color: Theme.colors.textPrimary,
    flex: 1,
    fontSize: Theme.typography.sizes.sm,
  },
  skip: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 96,
    paddingHorizontal: Theme.spacing.sm,
  },
  skipText: {
    color: Theme.colors.accentTeal,
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.semibold,
  },
});
