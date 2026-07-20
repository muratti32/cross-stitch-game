import React, { useRef, useEffect } from 'react';
import { Tabs, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '@/theme/theme';
import { Platform, StyleSheet, View, Animated, type ColorValue } from 'react-native';
import * as Haptics from 'expo-haptics';

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

  // Animation drivers
  const focusAnimation = useRef(new Animated.Value(focused ? 1 : 0)).current;
  const bounceAnimation = useRef(new Animated.Value(focused ? 1 : 0)).current;
  const idlePulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(focusAnimation, {
      toValue: focused ? 1 : 0,
      useNativeDriver: true,
      tension: 120,
      friction: 7,
    }).start();

    if (focused) {
      // Restart the pop each time the tab gains focus
      bounceAnimation.setValue(0);
      Animated.spring(bounceAnimation, {
        toValue: 1,
        useNativeDriver: true,
        tension: 180,
        friction: 5,
      }).start();
    } else {
      Animated.timing(bounceAnimation, {
        toValue: 0,
        duration: 120,
        useNativeDriver: true,
      }).start();
    }
  }, [focused, focusAnimation, bounceAnimation]);

  // Featured (Create) tab breathes gently while unfocused to draw attention
  useEffect(() => {
    if (!featured || focused) {
      idlePulse.stopAnimation();
      idlePulse.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(idlePulse, {
          toValue: 1,
          duration: 1100,
          useNativeDriver: true,
        }),
        Animated.timing(idlePulse, {
          toValue: 0,
          duration: 1100,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();

    return () => {
      loop.stop();
      idlePulse.setValue(0);
    };
  }, [featured, focused, idlePulse]);

  // Translate and scale interpolations for the entire icon frame
  const translateY = focusAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: featured ? [-6, -12] : [0, -3],
  });

  const scale = focusAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.05],
  });

  const idleScale = idlePulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.06],
  });

  // Pop + wobble for the focused icon glyph
  const iconPopScale = bounceAnimation.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.6, 1.25, 1],
  });

  const iconWobble = bounceAnimation.interpolate({
    inputRange: [0, 0.4, 0.7, 1],
    outputRange: ['-24deg', '12deg', '-5deg', '0deg'],
  });

  // Opacities for cross-fading unfocused/focused states
  const unfocusedOpacity = focusAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });

  const focusedOpacity = focusAnimation;

  // Stitch shape (diamond) animation
  const stitchScale = focusAnimation.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, 0, 1],
  });

  const stitchRotate = focusAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: ['-135deg', '45deg'],
  });

  // Resolve frame styling based on active/inactive states and features
  const unfocusedFrameStyle = featured ? styles.featuredUnfocusedFrame : styles.standardUnfocusedFrame;
  const focusedFrameStyle = featured ? styles.featuredFocusedFrame : styles[`${variant}FocusedFrame` as const] || styles.catalogFocusedFrame;

  // Resolve icon colors
  const unfocusedIconColor = featured ? Theme.colors.textPrimary : Theme.colors.textSecondary;
  const focusedIconColor = featured ? Theme.colors.textPrimary : Theme.colors.textLight;

  return (
    <Animated.View
      style={[
        featured ? styles.featuredContainer : styles.standardContainer,
        {
          transform: [{ translateY }, { scale }, { scale: idleScale }],
        },
      ]}
    >
      {/* 1. Unfocused Frame */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          styles.iconFrameBase,
          unfocusedFrameStyle,
          { opacity: unfocusedOpacity },
        ]}
      />

      {/* 2. Focused Frame (Fades in) */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          styles.iconFrameBase,
          focusedFrameStyle,
          { opacity: focusedOpacity },
        ]}
      />

      {/* 3. Icon Content Layers (Absolute-centered, decoupled from frame border heights to prevent shifting) */}
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.centerContent, { opacity: unfocusedOpacity }]}
      >
        <Ionicons
          name={inactiveIcon}
          size={featured ? 26 : 22}
          color={unfocusedIconColor}
        />
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.centerContent,
          {
            opacity: focusedOpacity,
            transform: [{ scale: iconPopScale }, { rotate: iconWobble }],
          },
        ]}
      >
        <Ionicons
          name={activeIcon}
          size={featured ? 26 : 22}
          color={focusedIconColor}
        />
      </Animated.View>

      {/* 4. Active Stitch Overlay (Little diamond stitch in the corner) */}
      <Animated.View
        style={[
          styles.activeStitch,
          featured && styles.activeStitchDark,
          {
            opacity: focusedOpacity,
            transform: [{ rotate: stitchRotate }, { scale: stitchScale }],
          },
        ]}
      />
    </Animated.View>
  );
}

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
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Theme.colors.accentTeal,
        tabBarInactiveTintColor: Theme.colors.textSecondary,
        tabBarActiveBackgroundColor: 'transparent',
        tabBarHideOnKeyboard: true,
        tabBarItemStyle: styles.tabItem,
        tabBarIconStyle: styles.tabIcon,
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
        listeners={{
          tabPress: resetCatalogOnPress,
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
        listeners={{
          tabPress: triggerHaptic,
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
        listeners={{
          tabPress: triggerFeaturedHaptic,
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
        listeners={{
          tabPress: triggerHaptic,
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
        listeners={{
          tabPress: triggerHaptic,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Theme.colors.gameBar,
    borderTopWidth: 0,
    paddingHorizontal: Theme.spacing.sm,
    paddingTop: Theme.spacing.sm,
    shadowColor: Theme.colors.gameBarShadow,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 18,
    overflow: 'visible',
  },
  tabItem: {
    borderRadius: Theme.radii.lg,
    marginHorizontal: 2,
    overflow: 'visible',
  },
  tabIcon: {
    marginBottom: Theme.spacing.sm,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: Theme.typography.weights.bold,
    letterSpacing: 0.2,
  },
  standardContainer: {
    width: 36,
    height: 36,
    position: 'relative',
  },
  featuredContainer: {
    width: 48,
    height: 48,
    position: 'relative',
  },
  iconFrameBase: {
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  centerContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  focusedIconFrameBase: {
    borderWidth: 1.5,
  },
  standardUnfocusedFrame: {
    borderRadius: Theme.radii.md,
    borderColor: Theme.colors.border,
    backgroundColor: Theme.colors.background,
  },
  featuredUnfocusedFrame: {
    borderRadius: Theme.radii.lg,
    borderColor: Theme.colors.textPrimary,
    borderWidth: 2,
    borderBottomWidth: 5,
    backgroundColor: Theme.colors.accentHoneySoft,
    shadowColor: Theme.colors.gameBarShadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 6,
  },
  featuredFocusedFrame: {
    borderRadius: Theme.radii.lg,
    borderColor: Theme.colors.textPrimary,
    borderWidth: 2,
    borderBottomWidth: 5,
    backgroundColor: Theme.colors.accentHoney,
  },
  catalogFocusedFrame: {
    borderRadius: Theme.radii.md,
    borderColor: Theme.colors.textPrimary,
    borderBottomWidth: 4,
    backgroundColor: Theme.colors.accentSage,
  },
  playFocusedFrame: {
    borderRadius: Theme.radii.md,
    borderColor: Theme.colors.textPrimary,
    borderBottomWidth: 4,
    backgroundColor: Theme.colors.accentRose,
  },
  profileFocusedFrame: {
    borderRadius: Theme.radii.md,
    borderColor: Theme.colors.textPrimary,
    borderBottomWidth: 4,
    backgroundColor: Theme.colors.accentTeal,
  },
  settingsFocusedFrame: {
    borderRadius: Theme.radii.md,
    borderColor: Theme.colors.textPrimary,
    borderBottomWidth: 4,
    backgroundColor: Theme.colors.textSecondary,
  },
  activeStitch: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 6,
    height: 6,
    borderRadius: 1,
    backgroundColor: Theme.colors.textLight,
  },
  activeStitchDark: {
    backgroundColor: Theme.colors.textPrimary,
  },
});
