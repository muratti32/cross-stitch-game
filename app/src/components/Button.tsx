import React from 'react';
import { StyleSheet, Pressable, Text, ActivityIndicator, ViewStyle, TextStyle, StyleProp } from 'react-native';
import { Theme } from '../theme/theme';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'rose' | 'sage' | 'honey';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  style,
  textStyle,
}: ButtonProps) {
  const getButtonStyles = (pressed: boolean) => {
    if (disabled) {
      return styles.disabledButton;
    }
    
    let baseStyle = styles.primaryButton;
    if (variant === 'secondary') baseStyle = styles.secondaryButton;
    else if (variant === 'rose') baseStyle = styles.roseButton;
    else if (variant === 'sage') baseStyle = styles.sageButton;
    else if (variant === 'honey') baseStyle = styles.honeyButton;

    return [baseStyle, pressed && styles.pressedButton];
  };

  const getTextColor = () => {
    if (disabled) return Theme.colors.disabledText;
    if (variant === 'secondary') return Theme.colors.accentTeal;
    return Theme.colors.textLight;
  };

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.buttonBase,
        getButtonStyles(pressed),
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={getTextColor()} />
      ) : (
        <Text style={[styles.textBase, { color: getTextColor() }, textStyle]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  buttonBase: {
    height: 48,
    borderRadius: Theme.radii.lg,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.lg,
    flexDirection: 'row',
  },
  textBase: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.semibold,
  },
  primaryButton: {
    backgroundColor: Theme.colors.accentTeal,
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: Theme.colors.accentTeal,
  },
  roseButton: {
    backgroundColor: Theme.colors.accentRose,
  },
  sageButton: {
    backgroundColor: Theme.colors.accentSage,
  },
  honeyButton: {
    backgroundColor: Theme.colors.accentHoney,
  },
  disabledButton: {
    backgroundColor: Theme.colors.disabledBackground,
  },
  pressedButton: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
});
