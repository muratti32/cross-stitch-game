import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
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

const BEAT_KEYS: Record<BeatId, string> = {
  thread_palette: 'coachBanner.beats.threadPalette',
  stitch_action: 'coachBanner.beats.stitchAction',
  mismatched_tap: 'coachBanner.beats.mismatchedTap',
  undo_action: 'coachBanner.beats.undoAction',
  stitch_sweep: 'coachBanner.beats.stitchSweep',
  thread_color_completion: 'coachBanner.beats.threadColorCompletion',
};

const HINT_KEYS: Record<HintId, string> = {
  anchored_zoom: 'coachBanner.hints.anchoredZoom',
  pan_vs_sweep: 'coachBanner.hints.panVsSweep',
  edge_auto_pan: 'coachBanner.hints.edgeAutoPan',
  remaining_cell_locator: 'coachBanner.hints.remainingCellLocator',
};

export function TutorialCoachBanner({ onSkip, onDismiss, beatId, hintId }: Props) {
  const { t } = useTranslation('onboarding');
  const copy = beatId ? t(BEAT_KEYS[beatId]) : t(HINT_KEYS[hintId!]);
  return (
    <View style={styles.banner} accessibilityRole="summary" pointerEvents="box-none">
      <Text style={styles.instruction} allowFontScaling>
        {copy}
      </Text>
      {beatId ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('coachBanner.skipAccessibilityLabel')} onPress={onSkip} style={styles.skip}>
          <Text style={styles.skipText} allowFontScaling>{t('coachBanner.skip')}</Text>
        </Pressable>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={t('coachBanner.dismissAccessibilityLabel')} onPress={onDismiss} style={styles.skip}>
          <Text style={styles.skipText} allowFontScaling>{t('coachBanner.dismiss')}</Text>
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
