import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '@/theme/theme';
import { Platform, StyleSheet, View, type ColorValue } from 'react-native';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

interface GameTabIconProps {
  activeIcon: IconName;
  inactiveIcon: IconName;
  color: ColorValue;
  focused: boolean;
  variant: 'catalog' | 'play' | 'create' | 'profile' | 'settings';
}

function GameTabIcon({
  activeIcon,
  inactiveIcon,
  color,
  focused,
  variant,
}: GameTabIconProps) {
  const featured = variant === 'create';

  return (
    <View
      style={[
        styles.iconFrame,
        featured && styles.featuredIconFrame,
        focused && styles.focusedIconFrame,
        focused && (featured ? styles.featuredFocusedIconFrame : styles.standardFocusedIconFrame),
        focused && styles[`${variant}IconFrame`],
      ]}
    >
      <Ionicons
        name={focused ? activeIcon : inactiveIcon}
        size={featured ? 26 : 22}
        color={focused && variant !== 'create' ? Theme.colors.textLight : color}
      />
      {focused && (
        <View
          style={[
            styles.activeStitch,
            variant === 'create' && styles.activeStitchDark,
          ]}
        />
      )}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Theme.colors.accentTeal,
        tabBarInactiveTintColor: Theme.colors.textSecondary,
        tabBarActiveBackgroundColor: 'transparent',
        tabBarHideOnKeyboard: true,
        tabBarItemStyle: styles.tabItem,
        tabBarStyle: {
          ...styles.tabBar,
          height: Platform.OS === 'ios' ? 96 : 78,
          paddingBottom: Platform.OS === 'ios' ? 22 : 8,
        },
        tabBarLabelStyle: {
          ...styles.tabLabel,
        },
      }}
    >
      <Tabs.Screen
        name="(catalog)"
        options={{
          title: 'Catalog',
          tabBarIcon: ({ color, focused }) => (
            <GameTabIcon
              activeIcon="compass"
              inactiveIcon="compass-outline"
              color={color}
              focused={focused}
              variant="catalog"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="(play)"
        options={{
          title: 'Stitch',
          tabBarIcon: ({ color, focused }) => (
            <GameTabIcon
              activeIcon="game-controller"
              inactiveIcon="game-controller-outline"
              color={color}
              focused={focused}
              variant="play"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="(create)"
        options={{
          title: 'Create',
          tabBarIcon: ({ color, focused }) => (
            <GameTabIcon
              activeIcon="color-wand"
              inactiveIcon="color-wand-outline"
              color={color}
              focused={focused}
              variant="create"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="(profile)"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <GameTabIcon
              activeIcon="shield"
              inactiveIcon="shield-outline"
              color={color}
              focused={focused}
              variant="profile"
            />
          ),
        }}
      />
      <Tabs.Screen
        name="(settings)"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => (
            <GameTabIcon
              activeIcon="settings"
              inactiveIcon="settings-outline"
              color={color}
              focused={focused}
              variant="settings"
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Theme.colors.gameBar,
    borderTopColor: Theme.colors.gameBarEdge,
    borderTopWidth: 3,
    paddingHorizontal: Theme.spacing.sm,
    paddingTop: Theme.spacing.sm,
    shadowColor: Theme.colors.gameBarShadow,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 18,
  },
  tabItem: {
    borderRadius: Theme.radii.lg,
    marginHorizontal: 2,
    overflow: 'visible',
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: Theme.typography.weights.bold,
    letterSpacing: 0.2,
  },
  iconFrame: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Theme.radii.md,
    borderColor: Theme.colors.border,
    borderWidth: 1.5,
    backgroundColor: Theme.colors.background,
  },
  focusedIconFrame: {
    borderColor: Theme.colors.gameBarEdge,
  },
  standardFocusedIconFrame: {
    borderBottomWidth: 4,
    transform: [{ translateY: -2 }, { scale: 1.04 }],
  },
  featuredFocusedIconFrame: {
    borderBottomWidth: 5,
    transform: [{ translateY: -7 }, { scale: 1.04 }],
  },
  catalogIconFrame: {
    backgroundColor: Theme.colors.accentSage,
  },
  playIconFrame: {
    backgroundColor: Theme.colors.accentRose,
  },
  createIconFrame: {
    backgroundColor: Theme.colors.accentHoney,
  },
  profileIconFrame: {
    backgroundColor: Theme.colors.accentTeal,
  },
  settingsIconFrame: {
    backgroundColor: Theme.colors.textSecondary,
  },
  featuredIconFrame: {
    width: 48,
    height: 48,
    borderRadius: Theme.radii.lg,
    borderColor: Theme.colors.gameBarEdge,
    borderWidth: 2,
    borderBottomWidth: 5,
    backgroundColor: Theme.colors.accentHoneySoft,
    transform: [{ translateY: -7 }],
    shadowColor: Theme.colors.gameBarShadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 6,
  },
  activeStitch: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 6,
    height: 6,
    borderRadius: 1,
    backgroundColor: Theme.colors.textLight,
    transform: [{ rotate: '45deg' }],
  },
  activeStitchDark: {
    backgroundColor: Theme.colors.gameBarEdge,
  },
});
