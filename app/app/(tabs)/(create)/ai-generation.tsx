import React from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';
import { Screen, EmptyState } from '@/components';
import { Theme } from '@/theme/theme';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function AiGenerationScreen() {
  const router = useRouter();

  return (
    <Screen style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={Theme.colors.accentTeal} />
        </Pressable>
        <Text style={styles.title}>AI Generator</Text>
      </View>
      <View style={styles.content}>
        <EmptyState
          icon="sparkles-outline"
          title="AI Generator is Coming Soon"
          body="Soon you will be able to describe your dream cozy design in text, and our custom AI models will generate an original pixel-art stitch pattern for you!"
          actionLabel="Back to Creation Hub"
          onAction={() => router.back()}
          actionVariant="sage"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: Theme.spacing.xl,
    paddingHorizontal: Theme.spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Theme.spacing.xxl,
    gap: Theme.spacing.md,
  },
  backButton: {
    padding: Theme.spacing.xs,
  },
  title: {
    fontSize: Theme.typography.sizes.xl,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: Theme.spacing.xxl,
  },
});
