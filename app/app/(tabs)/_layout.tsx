import React from 'react';
import { Tabs, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Theme } from '@/theme/theme';
import { AnimatedTabBar } from '@/components';
import * as Haptics from 'expo-haptics';
import { PLAY_TAB_ROOT } from '@/navigation/exitSession';
import { SETTINGS_TAB_ROOT } from '@/navigation/exitSignIn';

export const unstable_settings = {
  initialRouteName: '(catalog)',
};

export default function TabsLayout() {
  const { t } = useTranslation('shell');
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

  // Safety net for a session screen left on the (play) stack by an exit path that
  // never ran exitSession() — Android hardware back, the iOS swipe-back gesture.
  // Pressing Stitch always lands on the session list, never inside a session the
  // player already backed out of (#91).
  const resetPlayOnPress = () => {
    triggerHaptic();
    router.dismissTo(PLAY_TAB_ROOT);
  };

  // Same safety net for the sign-in screen, which every tab pushes onto the
  // (settings) stack. Without it a screen left behind by the hardware back
  // button or the swipe-back gesture greets the player on the next Settings
  // press instead of their settings (#223).
  const resetSettingsOnPress = () => {
    triggerHaptic();
    router.dismissTo(SETTINGS_TAB_ROOT);
  };

  return (
    <Tabs
      initialRouteName="(catalog)"
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
          title: t('tabs.catalog'),
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
          title: t('tabs.stitch'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'game-controller' : 'game-controller-outline'}
              size={22}
              color={color}
            />
          ),
        }}
        listeners={{
          tabPress: resetPlayOnPress,
        }}
      />
      <Tabs.Screen
        name="(create)"
        options={{
          title: t('tabs.create'),
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
          title: t('tabs.profile'),
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
          title: t('tabs.settings'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'settings' : 'settings-outline'}
              size={22}
              color={color}
            />
          ),
        }}
        listeners={{
          tabPress: resetSettingsOnPress,
        }}
      />
    </Tabs>
  );
}
