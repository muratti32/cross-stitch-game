import React from 'react';
import { StyleSheet, View, Text, Alert, Pressable } from 'react-native';
import { Screen, Card, Button } from '@/components';
import { Theme } from '@/theme/theme';
import { Config, isSentryConfigured } from '@/config';
import * as Sentry from '@sentry/react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

interface DebugSectionProps {
  title: string;
  children: React.ReactNode;
}

function DebugSection({ title, children }: DebugSectionProps) {
  return (
    <View style={styles.sectionContainer}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Card style={styles.card}>
        {children}
      </Card>
    </View>
  );
}

export default function DebugScreen() {
  const isConfigured = isSentryConfigured();

  const handleSendTestEvent = () => {
    if (!isConfigured) {
      Alert.alert(
        'Sentry Disabled',
        'Sentry is not configured (no DSN found), so no test event will be sent.'
      );
    } else {
      try {
        const eventId = Sentry.captureException(
          new Error('Sentry debug test event from Stitch Wish debug screen')
        );
        Alert.alert('Sentry', `Test event sent. Event ID: ${eventId}`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        Alert.alert('Error', `Failed to send test event: ${errMsg}`);
      }
    }
  };

  const handleThrowUncaughtError = () => {
    throw new Error('Sentry debug: intentional uncaught error');
  };

  return (
    <Screen scrollable contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Ionicons name="arrow-back" size={22} color={Theme.colors.textPrimary} />
        </Pressable>
        <Text style={styles.title}>Debug</Text>
      </View>

      <DebugSection title="Sentry">
        <Text style={styles.statusText}>
          {isConfigured
            ? `DSN: configured · env: ${Config.sentry.environment}`
            : 'DSN: not configured'}
        </Text>
        <View style={styles.buttonGroup}>
          <Button
            title="Send Test Event"
            onPress={handleSendTestEvent}
            variant="primary"
            style={styles.actionButton}
          />
          <Button
            title="Throw Error"
            onPress={handleThrowUncaughtError}
            variant="secondary"
            style={styles.actionButton}
          />
        </View>
      </DebugSection>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: Theme.spacing.xl,
    paddingHorizontal: Theme.spacing.lg,
    paddingBottom: Theme.spacing.xxl,
    backgroundColor: Theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Theme.spacing.xl,
    gap: Theme.spacing.xs,
  },
  backButton: {
    padding: Theme.spacing.xs,
    marginLeft: -Theme.spacing.xs,
  },
  title: {
    fontSize: Theme.typography.sizes.lg,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textPrimary,
  },
  sectionContainer: {
    marginBottom: Theme.spacing.lg,
  },
  sectionTitle: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textSecondary,
    textTransform: 'uppercase',
    fontVariant: ['small-caps'],
    letterSpacing: 1.0,
    marginBottom: Theme.spacing.xs,
    paddingLeft: Theme.spacing.xs,
  },
  card: {
    padding: Theme.spacing.md,
  },
  statusText: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    marginBottom: Theme.spacing.md,
  },
  buttonGroup: {
    gap: Theme.spacing.sm,
  },
  actionButton: {
    width: '100%',
  },
});
