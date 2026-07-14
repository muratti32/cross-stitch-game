import React from 'react';
import { StyleSheet, View, Text, Switch, ActivityIndicator, Pressable, Alert, Linking } from 'react-native';
import { Screen, Card, Button } from '@/components';
import { Theme } from '@/theme/theme';
import { useGameplayStore } from '@/store';
import { useHealthCheck } from '@/hooks/useHealthCheck';
import { Config } from '@/config';
import { Ionicons } from '@expo/vector-icons';
import { setHandedness as setHandednessDb } from '@/local-db';

export default function SettingsScreen() {
  const { showGridLines, toggleGridLines, handedness, setHandedness } = useGameplayStore();
  const { data: health, isLoading, error, refetch, isRefetching } = useHealthCheck();

  const handleHandednessChange = async (value: 'left' | 'right') => {
    setHandedness(value);
    try {
      await setHandednessDb(value);
    } catch (err) {
      console.error('Failed to save handedness preference to database:', err);
    }
  };

  const handleLinkPress = (title: string, url?: string) => {
    if (url) {
      Linking.openURL(url).catch(() => {
        Alert.alert('Error', `Could not open link: ${url}`);
      });
    } else {
      Alert.alert(title, 'This page will be available before release.');
    }
  };

  return (
    <Screen scrollable contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>Configure preferences and inspect backend systems.</Text>
      </View>

      {/* Backend Health Section */}
      <Text style={styles.sectionTitle}>Service Status</Text>
      <Card style={styles.healthCard}>
        <View style={styles.healthHeader}>
          <Text style={styles.healthTitle}>API connection</Text>
          <Text style={styles.apiUrlText} numberOfLines={1} ellipsizeMode="tail">
            {Config.apiBaseUrl}
          </Text>
        </View>

        {isLoading || isRefetching ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={Theme.colors.accentTeal} />
            <Text style={styles.loadingText}>Testing api connection...</Text>
          </View>
        ) : error ? (
          <View style={styles.errorContainer}>
            <View style={styles.statusBadgeError}>
              <View style={[styles.statusDot, { backgroundColor: Theme.colors.error }]} />
              <Text style={styles.errorText}>Offline / Unreachable</Text>
            </View>
            <Text style={styles.errorSubtext}>
              {error instanceof Error ? error.message : 'Unknown connection error'}
            </Text>
            <Button
              title="Retry Connection"
              onPress={() => refetch()}
              variant="secondary"
              style={styles.retryButton}
              textStyle={styles.retryButtonText}
            />
          </View>
        ) : health ? (
          <View style={styles.successContainer}>
            <View style={styles.healthStatusRow}>
              <View
                style={health.status === 'ok' ? styles.statusBadgeSuccess : styles.statusBadgeError}
              >
                <View
                  style={[
                    styles.statusDot,
                    {
                      backgroundColor:
                        health.status === 'ok' ? Theme.colors.success : Theme.colors.error,
                    },
                  ]}
                />
                <Text style={health.status === 'ok' ? styles.successText : styles.errorText}>
                  {health.status === 'ok' ? 'Healthy' : 'Degraded'}
                </Text>
              </View>
            </View>

            <View style={styles.subServicesContainer}>
              <View style={styles.subServiceRow}>
                <Text style={styles.subServiceName}>PostgreSQL Database</Text>
                <View style={styles.subServiceBadge}>
                  <View
                    style={[
                      styles.statusDotSmall,
                      {
                        backgroundColor:
                          health.checks.postgres === 'up'
                            ? Theme.colors.success
                            : Theme.colors.error,
                      },
                    ]}
                  />
                  <Text style={styles.subServiceStatus}>{health.checks.postgres}</Text>
                </View>
              </View>

              <View style={styles.subServiceDivider} />

              <View style={styles.subServiceRow}>
                <Text style={styles.subServiceName}>Redis Cache</Text>
                <View style={styles.subServiceBadge}>
                  <View
                    style={[
                      styles.statusDotSmall,
                      {
                        backgroundColor:
                          health.checks.redis === 'up'
                            ? Theme.colors.success
                            : Theme.colors.error,
                      },
                    ]}
                  />
                  <Text style={styles.subServiceStatus}>{health.checks.redis}</Text>
                </View>
              </View>
            </View>
          </View>
        ) : null}
      </Card>

      {/* Gameplay Preferences */}
      <Text style={styles.sectionTitle}>Gameplay Settings</Text>
      <Card style={styles.card}>
        <View style={styles.settingRow}>
          <View style={styles.settingTextContainer}>
            <Text style={styles.settingTitle}>Show Grid Lines</Text>
            <Text style={styles.settingDescription}>
              Display boundaries between sewing canvas cells (Zustand store)
            </Text>
          </View>
          <Switch
            value={showGridLines}
            onValueChange={toggleGridLines}
            trackColor={{ false: Theme.colors.disabledBackground, true: Theme.colors.accentSage }}
            thumbColor={showGridLines ? Theme.colors.card : Theme.colors.disabledText}
          />
        </View>
        <View style={styles.rowDivider} />
        <View style={styles.settingRow}>
          <View style={styles.settingTextContainer}>
            <Text style={styles.settingTitle}>Handedness Layout</Text>
            <Text style={styles.settingDescription}>
              Align interactive controls for left- or right-handed play
            </Text>
          </View>
          <View style={styles.segmentedControl}>
            <Pressable
              style={[
                styles.segmentButton,
                handedness === 'left' && styles.segmentButtonActive,
              ]}
              onPress={() => handleHandednessChange('left')}
              accessibilityRole="button"
              accessibilityLabel="Left handed layout"
            >
              <Text
                style={[
                  styles.segmentText,
                  handedness === 'left' && styles.segmentTextActive,
                ]}
              >
                Left
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.segmentButton,
                handedness === 'right' && styles.segmentButtonActive,
              ]}
              onPress={() => handleHandednessChange('right')}
              accessibilityRole="button"
              accessibilityLabel="Right handed layout"
            >
              <Text
                style={[
                  styles.segmentText,
                  handedness === 'right' && styles.segmentTextActive,
                ]}
              >
                Right
              </Text>
            </Pressable>
          </View>
        </View>
      </Card>

      {/* Links Section */}
      <Text style={styles.sectionTitle}>Information & Links</Text>
      <Card style={styles.card}>
        <Pressable
          onPress={() => handleLinkPress('Privacy Policy')}
          style={({ pressed }) => [styles.linkRow, pressed && styles.linkPressed]}
        >
          <Text style={styles.linkText}>Privacy Policy</Text>
          <Ionicons name="chevron-forward" size={16} color={Theme.colors.textSecondary} />
        </Pressable>
        <View style={styles.rowDivider} />
        
        <Pressable
          onPress={() => handleLinkPress('Terms of Service')}
          style={({ pressed }) => [styles.linkRow, pressed && styles.linkPressed]}
        >
          <Text style={styles.linkText}>Terms of Service</Text>
          <Ionicons name="chevron-forward" size={16} color={Theme.colors.textSecondary} />
        </Pressable>
        <View style={styles.rowDivider} />

        <Pressable
          onPress={() => handleLinkPress('Contact Support')}
          style={({ pressed }) => [styles.linkRow, pressed && styles.linkPressed]}
        >
          <Text style={styles.linkText}>Contact Support</Text>
          <Ionicons name="chevron-forward" size={16} color={Theme.colors.textSecondary} />
        </Pressable>
      </Card>

      {/* App details card */}
      <View style={styles.appDetails}>
        <Text style={styles.appDetailsText}>Stitch Wish — Cozy Pixel-Art Needlecraft</Text>
        <Text style={styles.appDetailsVersion}>Version 1.0.0 (Expo SDK 54)</Text>
        <Text style={styles.appDetailsIdentifier}>Package: com.avk.stitchwish</Text>
        <Text style={styles.appDetailsScheme}>Scheme: stitchwish://</Text>
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
  sectionTitle: {
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1.0,
    marginTop: Theme.spacing.lg,
    marginBottom: Theme.spacing.sm,
    paddingLeft: Theme.spacing.xs,
  },
  card: {
    padding: 0,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Theme.spacing.lg,
  },
  settingTextContainer: {
    flex: 1,
    paddingRight: Theme.spacing.md,
  },
  settingTitle: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  settingDescription: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    marginTop: Theme.spacing.xs,
  },
  healthCard: {
    padding: Theme.spacing.lg,
  },
  healthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.md,
  },
  healthTitle: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  apiUrlText: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    maxWidth: '50%',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Theme.spacing.md,
    gap: Theme.spacing.sm,
  },
  loadingText: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
  },
  errorContainer: {
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
  },
  statusBadgeError: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FDF2F2',
    borderWidth: 1,
    borderColor: '#FBD5D5',
    paddingVertical: Theme.spacing.xs,
    paddingHorizontal: Theme.spacing.sm,
    borderRadius: Theme.radii.sm,
    marginBottom: Theme.spacing.xs,
    gap: Theme.spacing.xs,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: Theme.radii.full,
  },
  errorText: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.error,
  },
  errorSubtext: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: Theme.spacing.md,
  },
  retryButton: {
    height: 36,
    paddingHorizontal: Theme.spacing.md,
  },
  retryButtonText: {
    fontSize: Theme.typography.sizes.sm,
  },
  successContainer: {
    paddingTop: Theme.spacing.xs,
  },
  healthStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.md,
  },
  statusBadgeSuccess: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3FAF4',
    borderWidth: 1,
    borderColor: '#DEF7EC',
    paddingVertical: Theme.spacing.xs,
    paddingHorizontal: Theme.spacing.sm,
    borderRadius: Theme.radii.sm,
    gap: Theme.spacing.xs,
  },
  successText: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.success,
  },
  subServicesContainer: {
    backgroundColor: '#FAF8F5',
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.md,
    paddingHorizontal: Theme.spacing.md,
  },
  subServiceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Theme.spacing.md,
  },
  subServiceName: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textPrimary,
    fontWeight: Theme.typography.weights.medium,
  },
  subServiceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.xs,
  },
  statusDotSmall: {
    width: 6,
    height: 6,
    borderRadius: Theme.radii.full,
  },
  subServiceStatus: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textSecondary,
    textTransform: 'capitalize',
  },
  subServiceDivider: {
    height: 1,
    backgroundColor: Theme.colors.border,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Theme.spacing.lg,
  },
  linkPressed: {
    backgroundColor: '#FAF8F5',
  },
  linkText: {
    fontSize: Theme.typography.sizes.md,
    color: Theme.colors.textPrimary,
    fontWeight: Theme.typography.weights.medium,
  },
  rowDivider: {
    height: 1,
    backgroundColor: Theme.colors.border,
    marginHorizontal: Theme.spacing.lg,
  },
  appDetails: {
    alignItems: 'center',
    marginTop: Theme.spacing.xxl,
    marginBottom: Theme.spacing.xl,
    gap: Theme.spacing.xs,
  },
  appDetailsText: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textSecondary,
  },
  appDetailsVersion: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
  },
  appDetailsIdentifier: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    opacity: 0.8,
  },
  appDetailsScheme: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    opacity: 0.8,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#EFECE6',
    borderRadius: Theme.radii.md,
    padding: 2,
    width: 140,
    height: 36,
  },
  segmentButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: Theme.radii.sm,
  },
  segmentButtonActive: {
    backgroundColor: Theme.colors.card,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentText: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.medium,
    color: Theme.colors.textSecondary,
  },
  segmentTextActive: {
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
});
