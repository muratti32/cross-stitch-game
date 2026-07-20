import React from 'react';
import { Tabs, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '@/theme/theme';
import { AnimatedTabBar } from '@/components';
import * as Haptics from 'expo-haptics';

export default function TabsLayout() {
  const triggerHaptic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const triggerFeaturedHaptic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
  };

  const resetCatalogOnPress = () => {
    triggerHaptic();
    router.dismissTo('/(tabs)/(catalog)');
  };

  return (
    <Tabs
      tabBar={(props) => <AnimatedTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Theme.colors.accentRose,
        tabBarInactiveTintColor: Theme.colors.textSecondary,
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="(catalog)"
        options={{
          title: 'Catalog',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'compass' : 'compass-outline'}
              size={22}
              color={color}
            />
          ),
        }}
        listeners={{
          tabPress: resetCatalogOnPress,
        }}
      />
      <Tabs.Screen
        name="(play)"
        options={{
          title: 'Stitch',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'game-controller' : 'game-controller-outline'}
              size={22}
              color={color}
            />
          ),
        }}
        listeners={{
          tabPress: triggerHaptic,
        }}
      />
      <Tabs.Screen
        name="(create)"
        options={{
          title: 'Create',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'add' : 'add-outline'}
              size={24}
              color={color}
            />
          ),
        }}
        listeners={{
          tabPress: triggerFeaturedHaptic,
        }}
      />
      <Tabs.Screen
        name="(profile)"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'person' : 'person-outline'}
              size={22}
              color={color}
            />
          ),
        }}
        listeners={{
          tabPress: triggerHaptic,
        }}
      />
      <Tabs.Screen
        name="(settings)"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'settings' : 'settings-outline'}
              size={22}
              color={color}
            />
          ),
        }}
        listeners={{
          tabPress: triggerHaptic,
        }}
      />
    </Tabs>
  );
}
