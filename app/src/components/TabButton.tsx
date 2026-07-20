import React, { useEffect, useRef } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type ColorValue,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '@/theme/theme';

const bounceConfig = {
  damping: 14,
  stiffness: 260,
  mass: 0.6,
};

export interface TabButtonProps {
  accessibilityLabel?: string;
  isFocused: boolean;
  label: string;
  onLongPress: () => void;
  onPress: () => void;
  renderIcon?: (props: {
    focused: boolean;
    color: ColorValue;
    size: number;
  }) => React.ReactNode;
  showLabel: boolean;
  activeColor: ColorValue;
  inactiveColor: ColorValue;
  isCreate?: boolean;
}

export function TabButton({
  accessibilityLabel,
  isFocused,
  label,
  onLongPress,
  onPress,
  renderIcon,
  showLabel,
  activeColor,
  inactiveColor,
  isCreate = false,
}: TabButtonProps) {
  const scale = useSharedValue(1);
  const translateY = useSharedValue(0);
  const wasFocused = useRef(isFocused);

  useEffect(() => {
    if (isFocused && !wasFocused.current) {
      scale.value = withSequence(
        withSpring(1.12, bounceConfig),
        withSpring(1, bounceConfig)
      );
      translateY.value = withSequence(
        withSpring(-2, bounceConfig),
        withSpring(0, bounceConfig)
      );
    } else if (!isFocused) {
      scale.value = withSpring(1, bounceConfig);
      translateY.value = withSpring(0, bounceConfig);
    }
    wasFocused.current = isFocused;
  }, [isFocused, scale, translateY]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { translateY: translateY.value }],
  }));

  const isSelectedTab = isFocused && !isCreate;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={isFocused ? { selected: true } : {}}
      onLongPress={onLongPress}
      onPress={onPress}
      style={styles.button}
    >
      <View
        style={[
          styles.buttonContent,
          isCreate ? styles.buttonContentCreate : styles.buttonContentNormal,
        ]}
      >
        {isSelectedTab ? <View pointerEvents="none" style={styles.activeBackground} /> : null}

        {isCreate ? (
          /* Special Create Button: Coral/orange circle with a white plus '+' sign */
          <Animated.View style={iconStyle}>
            <View style={styles.createIconContainer}>
              <Ionicons name="add" size={24} color="#FFFFFF" />
            </View>
          </Animated.View>
        ) : (
          /* Normal Tab Icon */
          <Animated.View style={iconStyle}>
            <View style={styles.iconContainer}>
              {renderIcon?.({
                focused: isFocused,
                color: isFocused ? activeColor : inactiveColor,
                size: 22,
              })}
            </View>
          </Animated.View>
        )}

        {showLabel ? (
          <Text
            numberOfLines={1}
            style={[
              styles.label,
              { color: isFocused ? activeColor : inactiveColor },
            ]}
          >
            {label}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  buttonContent: {
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 1.5,
    overflow: 'visible',
    position: 'relative',
  },
  buttonContentNormal: {
    height: 56, // Fixed height keeps the active pill background compact and prevents tabbar growth
    borderRadius: Theme.radii.lg, // Softer, premium rounded rectangle shape
    justifyContent: 'center',
  },
  buttonContentCreate: {
    paddingVertical: Theme.spacing.xs,
  },
  activeBackground: {
    position: 'absolute',
    top: -2,
    bottom: -2,
    left: 0,
    right: 0,
    borderRadius: Theme.radii.lg, // Matching radius for active background
    backgroundColor: 'rgba(195, 106, 118, 0.08)', // Light coral/rose background matching screenshot
  },
  iconContainer: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  createIconContainer: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#C36A76', // Accent Rose thread color for the main action
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
    shadowColor: '#C36A76',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  label: {
    fontSize: Theme.typography.sizes.xs - 1, // ~11px, looks extremely clean
    fontWeight: Theme.typography.weights.medium, // Clean regular-medium styling
    letterSpacing: 0.1,
    marginTop: 2,
  },
});
