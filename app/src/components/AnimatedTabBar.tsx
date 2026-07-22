import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Theme } from '@/theme/theme';
import { TabButton } from './TabButton';
import { TAB_BAR_HEIGHT } from '@/theme/tabBar';

export interface AnimatedTabBarProps {
  state: {
    routes: any[];
    index: number;
  };
  descriptors: Record<string, any>;
  navigation: any;
  showLabel?: boolean;
}

export function AnimatedTabBar({
  state,
  descriptors,
  navigation,
  showLabel = true,
}: AnimatedTabBarProps) {
  const insets = useSafeAreaInsets();
  const horizontalPadding = Theme.spacing.sm;

  const activeRoute = state.routes[state.index];
  const activeDescriptor = descriptors[activeRoute.key];
  const activeOptions = activeDescriptor?.options;

  if (activeOptions?.tabBarStyle?.display === 'none') {
    return null;
  }

  const containerStyle = useMemo(
    () => [
      styles.container,
      {
        bottom: insets.bottom > 0 ? insets.bottom : Theme.spacing.lg,
        paddingHorizontal: horizontalPadding,
      },
    ],
    [insets.bottom, horizontalPadding]
  );

  return (
    <View style={containerStyle}>
      <View style={styles.row}>
        {state.routes.map((route: any, index: number) => {
          const { options } = descriptors[route.key];
          const isFocused = state.index === index;
          const label =
            typeof options.tabBarLabel === 'string'
              ? options.tabBarLabel
              : typeof options.title === 'string'
                ? options.title
                : route.name;

          // Default styling variables
          const activeColor = options.tabBarActiveTintColor ?? Theme.colors.accentRose;
          const inactiveColor = options.tabBarInactiveTintColor ?? Theme.colors.textSecondary;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          const onLongPress = () => {
            navigation.emit({
              type: 'tabLongPress',
              target: route.key,
            });
          };

          return (
            <TabButton
              key={route.key}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              activeColor={activeColor}
              inactiveColor={inactiveColor}
              isFocused={isFocused}
              label={label}
              onLongPress={onLongPress}
              onPress={onPress}
              renderIcon={options.tabBarIcon}
              showLabel={showLabel}
              isCreate={route.name === '(create)' || route.name === 'create'}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: Theme.spacing.lg,
    right: Theme.spacing.lg,
    minHeight: TAB_BAR_HEIGHT,
    backgroundColor: 'rgba(255, 255, 255, 0.93)',
    borderRadius: 30,
    paddingTop: 4,
    paddingBottom: 4,
    borderWidth: 1.5,
    borderColor: 'rgba(234, 223, 201, 0.7)', // Border color matching Theme.colors.border with transparency
    shadowColor: '#2E2A25', // Using textPrimary color for subtle warm shadow
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
