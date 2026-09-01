import React from 'react';
import { StyleSheet, View, ScrollView, ViewStyle, StyleProp, RefreshControlProps } from 'react-native';
import { SafeAreaView, Edge } from 'react-native-safe-area-context';
import { Theme } from '../theme/theme';
import { StatusBar } from 'expo-status-bar';
import { useTabBarSpace } from '@/theme/tabBar';

export interface ScreenProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  scrollable?: boolean;
  edges?: Edge[];
  refreshControl?: React.ReactElement<RefreshControlProps>;
  clearsTabBar?: boolean;
}

export const Screen = React.forwardRef<ScrollView, ScreenProps>(function Screen(
  {
    children,
    style,
    contentContainerStyle,
    scrollable = false,
    edges = ['top', 'left', 'right'],
    refreshControl,
    clearsTabBar = true,
  },
  ref,
) {
  const tabBarSpace = useTabBarSpace();

  return (
    <SafeAreaView style={styles.safeArea} edges={edges}>
      <StatusBar style="dark" />
      {scrollable ? (
        <ScrollView
          style={[styles.container, style]}
          contentContainerStyle={[
            styles.scrollContent,
            contentContainerStyle,
            clearsTabBar && { paddingBottom: tabBarSpace },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.container, style, clearsTabBar && { paddingBottom: tabBarSpace }]}>
          {children}
        </View>
      )}
    </SafeAreaView>
  );
});

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  container: {
    flex: 1,
  },
  scrollContent: {
  },
});

