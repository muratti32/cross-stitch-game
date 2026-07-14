import React from 'react';
import { StyleSheet, View, Text, Pressable, ViewStyle, StyleProp } from 'react-native';
import { Theme } from '../theme/theme';

interface SectionHeaderProps {
  title: string;
  onSeeAll?: () => void;
  seeAllLabel?: string;
  style?: StyleProp<ViewStyle>;
}

export function SectionHeader({ title, onSeeAll, seeAllLabel = 'See All', style }: SectionHeaderProps) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.titleContainer}>
        {/* Cozy thread accent line */}
        <View style={styles.threadAccent} />
        <Text style={styles.title}>{title}</Text>
      </View>
      {onSeeAll && (
        <Pressable onPress={onSeeAll} style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
          <Text style={styles.linkLabel}>{seeAllLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: Theme.spacing.md,
    paddingHorizontal: Theme.spacing.lg,
  },
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  threadAccent: {
    width: 4,
    height: 18,
    borderRadius: Theme.radii.full,
    backgroundColor: Theme.colors.accentRose,
    marginRight: Theme.spacing.sm,
  },
  title: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  link: {
    paddingVertical: Theme.spacing.xs,
    paddingHorizontal: Theme.spacing.sm,
  },
  linkLabel: {
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.accentTeal,
  },
  pressed: {
    opacity: 0.7,
  },
});
