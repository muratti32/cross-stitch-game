import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Theme } from '../theme/theme';
import type { TutorialEffect } from './tutorialEngine';

interface Props {
  readonly onSkip: () => void;
  readonly beatId: Extract<TutorialEffect, { type: 'show_coach_mark' }>['beatId'];
}

const COPY: Record<Props['beatId'], string> = {
  thread_palette: 'Select DMC 321 Christmas Red.',
  stitch_action: 'Tap the highlighted matching cell.',
  mismatched_tap: 'Tap the highlighted different cell. Wrong taps cost nothing.',
  undo_action: 'Undo that stitch, then place it again.',
  stitch_sweep: 'Press a matching cell, then drag across the highlighted run.',
};

export function TutorialCoachBanner({ onSkip, beatId }: Props) {
  return (
    <View style={styles.banner} accessibilityRole="summary" pointerEvents="box-none">
      <Text style={styles.instruction} allowFontScaling>
        {COPY[beatId]}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Skip tutorial for now"
        onPress={onSkip}
        style={styles.skip}
      >
        <Text style={styles.skipText} allowFontScaling>Skip for now</Text>
      </Pressable>
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
