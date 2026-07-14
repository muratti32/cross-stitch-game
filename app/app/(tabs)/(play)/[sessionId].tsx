import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen, Button } from '@/components';
import { Theme } from '@/theme/theme';
import { getSession, StitchingSession } from '@/local-db';
import { loadBundledPattern } from '@/bundled-patterns';
import { PatternData } from '@/pattern-artifact';
import { StitchRenderer, RendererState } from '@/renderer';
import { useGameplayStore } from '@/store/gameplayStore';

export default function SessionReadyScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const router = useRouter();
  const [session, setSession] = useState<StitchingSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [patternData, setPatternData] = useState<PatternData | null>(null);
  const [rendererState, setRendererState] = useState<RendererState | null>(null);

  const { selectedColorIndex } = useGameplayStore();

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
      setRendererState(new RendererState(data.width, data.height));
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

  const handleCellTapped = (x: number, y: number) => {
    if (!patternData || !rendererState) return;

    const colorIdx = patternData.grid[y * patternData.width + x];
    // 0 = empty, 1..N = palette color index + 1
    if (colorIdx > 0 && colorIdx - 1 === selectedColorIndex) {
      if (!rendererState.isCompleted(x, y)) {
        rendererState.setCompleted(x, y, true);
      }
    }
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

  const selectedColor = patternData ? patternData.palette[selectedColorIndex] : null;

  return (
    <Screen style={styles.fullscreenContainer}>
      {/* Header Bar */}
      <View style={styles.header}>
        <Button
          variant="secondary"
          title="← Table"
          onPress={() => router.navigate('/(tabs)/(play)')}
          style={styles.backButton}
        />
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {patternData ? `Stitching: ${patternData.palette.length} Colors` : 'Canvas'}
          </Text>
          {selectedColor && (
            <View style={styles.colorSwatchRow}>
              <View style={[styles.swatch, { backgroundColor: selectedColor.rgbHex }]} />
              <Text style={styles.swatchText} numberOfLines={1}>
                Active: DMC {selectedColor.dmcCode} ({selectedColor.name})
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Skia Tile Renderer Canvas */}
      {patternData && rendererState && (
        <StitchRenderer
          pattern={patternData}
          rendererState={rendererState}
          onCellTapped={handleCellTapped}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
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
  fullscreenContainer: {
    flex: 1,
    backgroundColor: '#FAF6F0',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    backgroundColor: Theme.colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Theme.colors.border,
  },
  backButton: {
    height: 36,
    paddingHorizontal: Theme.spacing.sm,
    borderRadius: Theme.radii.md,
    marginRight: Theme.spacing.md,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  colorSwatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    marginRight: 6,
  },
  swatchText: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
  },
});

