import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useIdentityStore } from '@/identity/guestIdentity';
import { MEMBERSHIP_THEMES, useActiveMembershipTheme } from '@/membership/themes';
import { Theme } from '@/theme/theme';

import { Button } from './Button';
import { Card } from './Card';

export function ThemeCollectionCard() {
  const { t } = useTranslation('settings');
  const router = useRouter();
  const isAccount = useIdentityStore((state) => state.isAccount);
  const { theme, themeAccess, selectTheme } = useActiveMembershipTheme(isAccount);

  const openPremium = () => {
    router.push({
      pathname: '/(tabs)/(profile)/commerce',
      params: { category: 'premium', source: 'premium_benefit' },
    });
  };

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>{t('themeCollectionCard.title')}</Text>
          <Text style={styles.description}>
            {t('themeCollectionCard.description')}
          </Text>
        </View>
        {!themeAccess && (
          <View style={styles.lockBadge}>
            <Ionicons name="lock-closed-outline" size={14} color={Theme.colors.textSecondary} />
            <Text style={styles.lockBadgeText}>{t('themeCollectionCard.premiumBadge')}</Text>
          </View>
        )}
      </View>

      <View style={styles.themeRow}>
        {MEMBERSHIP_THEMES.map((candidate) => {
          const locked = candidate.premium && !themeAccess;
          const selected = theme.id === candidate.id;
          return (
            <Pressable
              accessibilityHint={locked ? t('themeCollectionCard.lockedAccessibilityHint') : undefined}
              accessibilityRole="button"
              key={candidate.id}
              onPress={locked ? openPremium : () => void selectTheme(candidate.id)}
              style={({ pressed }) => [
                styles.themeOption,
                { backgroundColor: candidate.gridBackground },
                selected && styles.themeOptionSelected,
                locked && styles.themeOptionLocked,
                pressed && styles.pressed,
              ]}
              testID={`appearance-theme-${candidate.id}`}
            >
              <Ionicons
                name={locked ? 'lock-closed-outline' : 'color-palette-outline'}
                size={18}
                color={candidate.celebrationAccent}
              />
              <Text style={styles.themeOptionText}>{candidate.name}</Text>
              {selected && <Text style={styles.selectedText}>{t('themeCollectionCard.selected')}</Text>}
            </Pressable>
          );
        })}
      </View>

      {themeAccess ? (
        <Text style={styles.accessText}>
          {t('themeCollectionCard.accessActive')}
        </Text>
      ) : (
        <View style={styles.lockedGuidance} testID="theme-collection-locked">
          <Text style={styles.description}>
            {t('themeCollectionCard.lockedPreview')}
          </Text>
          <Button title={t('themeCollectionCard.viewPremiumPlans')} onPress={openPremium} variant="rose" />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  accessText: { color: Theme.colors.success, fontSize: Theme.typography.sizes.xs },
  card: { gap: Theme.spacing.md },
  description: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.xs,
    lineHeight: 18,
  },
  header: { alignItems: 'flex-start', flexDirection: 'row', gap: Theme.spacing.sm },
  headerCopy: { flex: 1, gap: Theme.spacing.xs },
  lockBadge: {
    alignItems: 'center',
    backgroundColor: Theme.colors.disabledBackground,
    borderRadius: Theme.radii.full,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: Theme.spacing.xs,
  },
  lockBadgeText: { color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.xs },
  lockedGuidance: { gap: Theme.spacing.sm },
  pressed: { opacity: 0.75 },
  selectedText: {
    color: Theme.colors.accentRose,
    fontSize: 9,
    fontWeight: Theme.typography.weights.bold,
  },
  themeOption: {
    alignItems: 'center',
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.md,
    borderWidth: 1,
    flex: 1,
    gap: Theme.spacing.xs,
    justifyContent: 'center',
    minHeight: 82,
    padding: Theme.spacing.xs,
  },
  themeOptionLocked: { opacity: 0.65 },
  themeOptionSelected: { borderColor: Theme.colors.accentRose, borderWidth: 2 },
  themeOptionText: {
    color: Theme.colors.textPrimary,
    fontSize: 10,
    fontWeight: Theme.typography.weights.semibold,
    textAlign: 'center',
  },
  themeRow: { flexDirection: 'row', gap: Theme.spacing.sm },
  title: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.bold,
  },
});
