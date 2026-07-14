import React from 'react';
import { StyleSheet, Pressable, View, ViewStyle, StyleProp } from 'react-native';
import { Theme } from '../theme/theme';

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  disabled?: boolean;
}

export function Card({ children, style, onPress, disabled = false }: CardProps) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [
          styles.card,
          pressed && styles.pressed,
          disabled && styles.disabled,
          style,
        ]}
      >
        {children}
      </Pressable>
    );
  }

  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.lg,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    padding: Theme.spacing.lg,
    // Soft cozy shadow
    shadowColor: '#2E2A25',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  pressed: {
    backgroundColor: '#FAF7F2',
    transform: [{ scale: 0.99 }],
  },
  disabled: {
    opacity: 0.5,
  },
});
