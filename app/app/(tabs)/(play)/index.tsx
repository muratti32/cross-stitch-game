import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { Screen, EmptyState } from '@/components';
import { Theme } from '@/theme/theme';
import { useRouter } from 'expo-router';

export default function PlayScreen() {
  const router = useRouter();

  // Typed empty state for active/recent stitching sessions
  const activeSessions: any[] = []; // Using any[] temporarily for empty scaffold or type it strictly

  const handleStartStitching = () => {
    router.navigate('/(tabs)/(catalog)');
  };

  return (
    <Screen scrollable contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Stitching Table</Text>
        <Text style={styles.subtitle}>Pick up where you left off or resume a recent craft.</Text>
      </View>

      <View style={styles.content}>
        {activeSessions.length === 0 ? (
          <EmptyState
            icon="play-circle-outline"
            title="No Active Crafts"
            body="Your stitching frame is currently empty. Browse the pattern catalog to find something beautiful to stitch!"
            actionLabel="Browse Catalog"
            onAction={handleStartStitching}
            actionVariant="primary"
          />
        ) : (
          null // Session cards will render here when gameplay store is integrated
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: Theme.spacing.xl,
    paddingHorizontal: Theme.spacing.lg,
    paddingBottom: Theme.spacing.xxl,
  },
  header: {
    marginBottom: Theme.spacing.xl,
  },
  title: {
    fontSize: Theme.typography.sizes.xxl,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  subtitle: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    marginTop: Theme.spacing.xs,
  },
  content: {
    flex: 1,
  },
});
