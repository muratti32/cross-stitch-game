import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, Image, ActivityIndicator, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen, Button, Card } from '@/components';
import { Theme } from '@/theme/theme';
import { BUNDLED_PATTERNS, loadBundledPattern } from '@/bundled-patterns';
import { PatternData } from '@/pattern-artifact';
import { createSession } from '@/local-db';

export default function PatternDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [patternData, setPatternData] = useState<PatternData | null>(null);
  const [stitching, setStitching] = useState(false);

  const manifestPattern = BUNDLED_PATTERNS.find((p) => p.id === id);

  const loadData = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await loadBundledPattern(id);
      setPatternData(data);
    } catch (err) {
      console.error('Failed to load pattern artifact:', err);
      setError(err instanceof Error ? err.message : 'Failed to decode pattern file.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [id]);

  if (!manifestPattern) {
    return (
      <Screen style={styles.errorContainer}>
        <Text style={styles.errorTitle}>Pattern Not Found</Text>
        <Text style={styles.errorText}>The requested pattern does not exist in our catalog.</Text>
        <Button title="Go Back" onPress={() => router.back()} style={styles.errorButton} />
      </Screen>
    );
  }

  const handleStartStitching = async () => {
    try {
      setStitching(true);
      // Create session in local SQLite database
      await createSession(manifestPattern.id, manifestPattern.checksum);
      // Navigate to Play tab
      router.navigate('/(tabs)/(play)');
    } catch (err) {
      console.error('Failed to start stitching session:', err);
      setError('Failed to create a stitching session. Please try again.');
    } finally {
      setStitching(false);
    }
  };

  return (
    <Screen scrollable contentContainerStyle={styles.container}>
      {/* Back navigation header */}
      <View style={styles.headerRow}>
        <Button
          variant="secondary"
          title="← Back"
          onPress={() => router.back()}
          style={styles.backButton}
        />
      </View>

      {/* Pattern Visual Preview */}
      <View style={styles.imageContainer}>
        <Image source={manifestPattern.previewAsset} style={styles.previewImage} />
      </View>

      {/* Pattern Title & Description */}
      <View style={styles.infoSection}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{manifestPattern.title}</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{manifestPattern.difficulty.toUpperCase()}</Text>
          </View>
        </View>
        <Text style={styles.description}>
          {manifestPattern.description || 'No description available.'}
        </Text>
      </View>

      {/* Technical Specs */}
      <Card style={styles.specsCard}>
        <View style={styles.specItem}>
          <Text style={styles.specLabel}>Dimensions</Text>
          <Text style={styles.specValue}>
            {manifestPattern.width} × {manifestPattern.height}
          </Text>
        </View>
        <View style={styles.specDivider} />
        <View style={styles.specItem}>
          <Text style={styles.specLabel}>Total Stitches</Text>
          <Text style={styles.specValue}>{manifestPattern.cellsCount}</Text>
        </View>
        <View style={styles.specDivider} />
        <View style={styles.specItem}>
          <Text style={styles.specLabel}>Colors</Text>
          <Text style={styles.specValue}>{manifestPattern.colorsCount} Threads</Text>
        </View>
      </Card>

      {/* Thread Palette Section */}
      <View style={styles.paletteSection}>
        <Text style={styles.sectionTitle}>Required Threads</Text>
        {loading ? (
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="small" color={Theme.colors.accentTeal} />
            <Text style={styles.loadingText}>Reading thread palette...</Text>
          </View>
        ) : error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>Failed to load palette: {error}</Text>
            <Button title="Retry Loading" onPress={loadData} variant="rose" style={styles.retryButton} />
          </View>
        ) : patternData ? (
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
        ) : null}
      </View>

      {/* Actions */}
      <View style={styles.actionContainer}>
        <Button
          title={stitching ? 'Starting...' : 'Start Stitching'}
          onPress={handleStartStitching}
          variant="primary"
          loading={stitching}
          disabled={loading || !!error}
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
    width: 240,
    height: 240,
    borderRadius: Theme.radii.lg,
    backgroundColor: '#FAF6F0',
    borderWidth: 1,
    borderColor: Theme.colors.border,
    shadowColor: '#2E2A25',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
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
  badge: {
    backgroundColor: Theme.colors.overlayPressed,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: 4,
    borderRadius: Theme.radii.full,
    marginLeft: Theme.spacing.md,
  },
  badgeText: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.accentTeal,
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
  loaderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Theme.spacing.xl,
  },
  loadingText: {
    marginLeft: Theme.spacing.sm,
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.sm,
  },
  errorBanner: {
    padding: Theme.spacing.lg,
    backgroundColor: 'rgba(211, 93, 93, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(211, 93, 93, 0.2)',
    borderRadius: Theme.radii.md,
    alignItems: 'center',
  },
  errorBannerText: {
    color: Theme.colors.error,
    fontSize: Theme.typography.sizes.sm,
    textAlign: 'center',
    marginBottom: Theme.spacing.md,
  },
  retryButton: {
    height: 36,
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
  actionContainer: {
    marginTop: Theme.spacing.md,
  },
  actionButton: {
    width: '100%',
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
  errorButton: {
    width: 150,
  },
});
