import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { UnlockableTier, unlockPriceForTier } from '@/api/economy';
import { formatNumber } from '@/i18n';
import { Theme } from '@/theme/theme';

export type PatternLockState = { locked: false } | { locked: true; price: number };

export function patternLockState(
  tier: UnlockableTier | null,
  patternId: string,
  unlockedIds: ReadonlySet<string> | null,
): PatternLockState {
  if (tier === null || unlockedIds === null || unlockedIds.has(patternId)) {
    return { locked: false };
  }
  return { locked: true, price: unlockPriceForTier(tier) };
}

export function PatternLockBadge({
  tier,
  patternId,
  unlockedIds,
  forceLocked = false,
  style,
}: {
  tier: UnlockableTier | null;
  patternId: string;
  unlockedIds: ReadonlySet<string> | null;
  forceLocked?: boolean;
  style?: ViewStyle;
}) {
  const { t, i18n } = useTranslation('catalog');
  const state = forceLocked && tier !== null
    ? { locked: true as const, price: unlockPriceForTier(tier) }
    : patternLockState(tier, patternId, unlockedIds);
  if (!state.locked) return null;

  const formattedPrice = formatNumber(state.price, i18n.language);
  return (
    <View
      style={[styles.badge, style]}
      accessibilityLabel={t('common.patternLock.accessibilityLabel', { price: formattedPrice })}
    >
      <Ionicons name="lock-closed" size={12} color={Theme.colors.textPrimary} />
      <Text style={styles.price}>{formattedPrice} 🪙</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: Theme.radii.full,
    backgroundColor: Theme.colors.overlayPressed,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  price: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.semibold,
  },
});
