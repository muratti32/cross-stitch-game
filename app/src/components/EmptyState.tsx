import React from 'react';
import { StyleSheet, View, Text, ViewStyle, StyleProp } from 'react-native';
import { Theme } from '../theme/theme';
import { Button } from './Button';
import { Ionicons } from '@expo/vector-icons';

interface EmptyStateProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  actionVariant?: 'primary' | 'secondary' | 'rose' | 'sage' | 'honey';
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({
  icon,
  title,
  body,
  actionLabel,
  onAction,
  actionVariant = 'primary',
  style,
}: EmptyStateProps) {
  return (
    <View style={[styles.container, style]}>
      <View style={styles.iconWrapper}>
        <Ionicons name={icon} size={36} color={Theme.colors.accentRose} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {actionLabel && onAction && (
        <Button
          title={actionLabel}
          onPress={onAction}
          variant={actionVariant}
          style={styles.button}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Theme.spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.lg,
    borderWidth: 1.5,
    borderColor: Theme.colors.border,
    borderStyle: 'dashed',
    marginVertical: Theme.spacing.md,
  },
  iconWrapper: {
    width: 64,
    height: 64,
    borderRadius: Theme.radii.full,
    backgroundColor: '#FCFAF7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Theme.spacing.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  title: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
    textAlign: 'center',
    marginBottom: Theme.spacing.xs,
  },
  body: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: Theme.spacing.md,
    paddingHorizontal: Theme.spacing.sm,
  },
  button: {
    minWidth: 140,
    height: 40,
  },
});
