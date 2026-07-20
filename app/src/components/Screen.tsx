import React from 'react';
import { StyleSheet, View, ScrollView, ViewStyle, StyleProp, RefreshControlProps } from 'react-native';
import { SafeAreaView, Edge } from 'react-native-safe-area-context';
import { Theme } from '../theme/theme';
import { StatusBar } from 'expo-status-bar';

interface ScreenProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  scrollable?: boolean;
  edges?: Edge[];
  refreshControl?: React.ReactElement<RefreshControlProps>;
}

export function Screen({
  children,
  style,
  contentContainerStyle,
  scrollable = false,
  edges = ['top', 'left', 'right'],
  refreshControl,
}: ScreenProps) {
  return (
    <SafeAreaView style={styles.safeArea} edges={edges}>
      <StatusBar style="dark" />
      {scrollable ? (
        <ScrollView
          style={[styles.container, style]}
          contentContainerStyle={[styles.scrollContent, contentContainerStyle]}
          showsVerticalScrollIndicator={false}
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.container, style]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Theme.colors.background,
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
  },
});
