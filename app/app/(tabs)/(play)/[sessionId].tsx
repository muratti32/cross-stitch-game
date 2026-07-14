import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, Image, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen, Button, Card } from '@/components';
import { Theme } from '@/theme/theme';
import { getSession, StitchingSession } from '@/local-db';
import { BUNDLED_PATTERNS, loadBundledPattern } from '@/bundled-patterns';
import { PatternData } from '@/pattern-artifact';

export default function SessionReadyScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const [session, setSession] = useState<StitchingSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [patternData, setPatternData] = useState<PatternData | null>(null);

  const loadSessionAndData = async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const activeSession = await getSession(sessionId);
      if (!activeSession) {
        setError('Stitching session not found.');
        setLoading(false);
        return;
      }
      setSession(activeSession);

      // Try decoding the pattern artifact here
      const data = await loadBundledPattern(activeSession.patternId);
      setPatternData(data);
    } catch (err) {
      console.error('Failed to open stitching session:', err);
      setError(
        err instanceof Error ? err.message : 'Corrupted pattern artifact detected.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessionAndData();
  }, [sessionId]);

  const handleStartStitching = () => {
    Alert.alert(
      'Ready to Stitch!',
      'The stitching canvas and interactive gameplay renderer will be implemented in the next step (issue #4/#5). Stay tuned!',
      [{ text: 'Cozy!' }]
    );
  };

  if (loading) {
    return (
      <Screen style={styles.loaderContainer}>
        <ActivityIndicator size="large" color={Theme.colors.accentTeal} />
        <Text style={styles.loadingText}>Opening session & preparing fabric...</Text>
      </Screen>
    );
  }

  if (error || !session) {
    return (
      <Screen style={styles.errorContainer}>
        <Text style={styles.errorTitle}>Session Load Failed</Text>
        <Text style={styles.errorText}>
          {error || 'Unable to load your stitching session.'}
        </Text>
        <View style={styles.errorActions}>
          <Button
            title="Retry Loading"
            onPress={loadSessionAndData}
            variant="rose"
            style={styles.errorBtn}
          />
          <Button
            title="Go to Table"
            onPress={() => router.navigate('/(tabs)/(play)')}
            variant="secondary"
            style={styles.errorBtn}
          />
        </View>
      </Screen>
    );
  }

  const pattern = BUNDLED_PATTERNS.find((p) => p.id === session.patternId);

  return (
    <Screen scrollable contentContainerStyle={styles.container}>
      {/* Header Back Button */}
      <View style={styles.headerRow}>
        <Button
          variant="secondary"
          title="← Stitching Table"
          onPress={() => router.navigate('/(tabs)/(play)')}
          style={styles.backButton}
        />
      </View>

      {/* Pattern Preview */}
      {pattern && (
        <View style={styles.imageContainer}>
          <Image source={pattern.previewAsset} style={styles.previewImage} />
        </View>
      )}

      {/* Session Title & Status */}
      <View style={styles.infoSection}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{pattern?.title || 'Session Details'}</Text>
          <View style={styles.statusBadge}>
            <Text style={styles.statusBadgeText}>READY</Text>
          </View>
        </View>
        <Text style={styles.description}>
          {pattern?.description || 'Your canvas is ready for cross-stitch.'}
        </Text>
      </View>

      {/* Grid Dimensions & Colors */}
      <Card style={styles.specsCard}>
        <View style={styles.specItem}>
          <Text style={styles.specLabel}>Width × Height</Text>
          <Text style={styles.specValue}>
            {pattern?.width} × {pattern?.height}
          </Text>
        </View>
        <View style={styles.specDivider} />
        <View style={styles.specItem}>
          <Text style={styles.specLabel}>Total Stitches</Text>
          <Text style={styles.specValue}>{pattern?.cellsCount}</Text>
        </View>
        <View style={styles.specDivider} />
        <View style={styles.specItem}>
          <Text style={styles.specLabel}>Difficulty</Text>
          <Text style={styles.specValue}>
            {pattern?.difficulty.toUpperCase()}
          </Text>
        </View>
      </Card>

      {/* Thread list */}
      <View style={styles.paletteSection}>
        <Text style={styles.sectionTitle}>Stitch Thread Palette</Text>
        {patternData ? (
          <View style={styles.paletteList}>
            {patternData.palette.map((color, index) => (
              <View key={index} style={styles.paletteItem}>
                <View style={[styles.colorChip, { backgroundColor: color.rgbHex }]} />
                <View style={styles.colorInfo}>
                  <Text style={styles.colorDmc}>DMC {color.dmcCode}</Text>
                  <Text style={styles.colorName}>{color.name}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.noPaletteText}>No palette details loaded.</Text>
        )}
      </View>

      {/* Primary Action Button */}
      <View style={styles.actionContainer}>
        <Button
          title="Open Stitching Canvas"
          onPress={handleStartStitching}
          variant="primary"
          style={styles.actionButton}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Theme.spacing.lg,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.xxl,
  },
  headerRow: {
    marginBottom: Theme.spacing.md,
  },
  backButton: {
    alignSelf: 'flex-start',
    height: 36,
    paddingHorizontal: Theme.spacing.md,
    borderRadius: Theme.radii.md,
  },
  imageContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Theme.spacing.xl,
  },
  previewImage: {
    width: 200,
    height: 200,
    borderRadius: Theme.radii.lg,
    backgroundColor: '#FAF6F0',
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  infoSection: {
    marginBottom: Theme.spacing.lg,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Theme.spacing.xs,
  },
  title: {
    fontSize: Theme.typography.sizes.xxl,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
    flex: 1,
  },
  statusBadge: {
    backgroundColor: 'rgba(122, 154, 130, 0.15)', // Sage transparent
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: 4,
    borderRadius: Theme.radii.full,
    marginLeft: Theme.spacing.md,
  },
  statusBadgeText: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.accentSage,
  },
  description: {
    fontSize: Theme.typography.sizes.md,
    color: Theme.colors.textSecondary,
    lineHeight: 22,
    marginTop: Theme.spacing.xs,
  },
  specsCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Theme.spacing.md,
    paddingHorizontal: Theme.spacing.md,
    marginBottom: Theme.spacing.xl,
  },
  specItem: {
    flex: 1,
    alignItems: 'center',
  },
  specLabel: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    marginBottom: 4,
  },
  specValue: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textPrimary,
  },
  specDivider: {
    width: 1,
    height: 32,
    backgroundColor: Theme.colors.border,
  },
  paletteSection: {
    marginBottom: Theme.spacing.xl,
  },
  sectionTitle: {
    fontSize: Theme.typography.sizes.lg,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
    marginBottom: Theme.spacing.md,
  },
  paletteList: {
    gap: Theme.spacing.sm,
  },
  paletteItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    padding: Theme.spacing.sm,
  },
  colorChip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  colorInfo: {
    marginLeft: Theme.spacing.md,
  },
  colorDmc: {
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textPrimary,
  },
  colorName: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
  },
  noPaletteText: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    fontStyle: 'italic',
  },
  actionContainer: {
    marginTop: Theme.spacing.md,
  },
  actionButton: {
    width: '100%',
  },
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: Theme.spacing.md,
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Theme.spacing.xl,
  },
  errorTitle: {
    fontSize: Theme.typography.sizes.xl,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.error,
    marginBottom: Theme.spacing.sm,
  },
  errorText: {
    fontSize: Theme.typography.sizes.md,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: Theme.spacing.xl,
  },
  errorActions: {
    flexDirection: 'row',
    gap: Theme.spacing.md,
  },
  errorBtn: {
    width: 130,
  },
});
