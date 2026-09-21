import React from 'react';
import { StyleProp, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '@/theme/theme';
import { Button } from './Button';

interface BackButtonProps {
  title: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

export function BackButton({ title, onPress, style }: BackButtonProps) {
  const label = title.replace(/^\s*←\s*/u, '');

  return (
    <Button
      variant="secondary"
      title={label}
      leadingIcon={<Ionicons name="arrow-back" size={20} color={Theme.colors.accentTeal} />}
      onPress={onPress}
      style={[styles.button, style]}
    />
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: Theme.spacing.md,
    borderRadius: Theme.radii.md,
  },
});
