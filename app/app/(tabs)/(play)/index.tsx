import React, { useState, useCallback } from 'react';
import { StyleSheet, View, Text, Image, FlatList, ActivityIndicator } from 'react-native';
import { Screen, EmptyState, Card, Button } from '@/components';
import { Theme } from '@/theme/theme';
import { useRouter, useFocusEffect } from 'expo-router';
import { getSessions, deleteSession, getSessionCompletedCount, StitchingSession } from '@/local-db';
import { BUNDLED_PATTERNS } from '@/bundled-patterns';

export default function PlayScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<(StitchingSession & { progress: number })[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSessionsList = async () => {
    try {
      const data = await getSessions();
      const sessionsWithProgress = await Promise.all(
        data.map(async (sess) => {
          const pattern = BUNDLED_PATTERNS.find((p) => p.id === sess.patternId);
          if (!pattern) return { ...sess, progress: 0 };
          const completedCount = await getSessionCompletedCount(sess.id, pattern.width, pattern.height);
          const totalCount = pattern.cellsCount || (pattern.width * pattern.height);
          const progress = totalCount > 0 ? Math.floor((completedCount / totalCount) * 100) : 0;
          return {
            ...sess,
            progress,
          };
        })
      );
      setSessions(sessionsWithProgress);
    } catch (err) {
      console.error('Failed to load stitching sessions:', err);
    } finally {
      setLoading(false);
    }
  };

  // Reload sessions whenever the tab comes into focus
  useFocusEffect(
    useCallback(() => {
      loadSessionsList();
    }, [])
  );

  const handleStartStitching = () => {
    router.navigate('/(tabs)/(catalog)');
  };

  const handleOpenSession = (sessionId: string) => {
    router.push(`/(tabs)/(play)/${sessionId}`);
  };

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await deleteSession(sessionId);
      await loadSessionsList();
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  const renderSessionItem = ({ item }: { item: StitchingSession & { progress: number } }) => {
    const pattern = BUNDLED_PATTERNS.find((p) => p.id === item.patternId);

    if (!pattern) {
      return (
        <Card style={styles.sessionCard}>
          <View style={styles.unknownPatternContainer}>
            <Text style={styles.sessionTitle}>Unknown Pattern ({item.patternId})</Text>
            <Button
              title="Delete"
              onPress={() => handleDeleteSession(item.id)}
              variant="rose"
              style={styles.deleteBtn}
            />
          </View>
        </Card>
      );
    }

    return (
      <Card style={styles.sessionCard} onPress={() => handleOpenSession(item.id)}>
        <Image source={pattern.previewAsset} style={styles.sessionImage} />
        
        <View style={styles.sessionInfo}>
          <View style={styles.titleRow}>
            <Text style={styles.sessionTitle} numberOfLines={1}>
              {pattern.title}
            </Text>
            {item.status === 'completed' ? (
              <View style={[styles.readyBadge, { backgroundColor: 'rgba(122, 154, 130, 0.15)' }]}>
                <Text style={[styles.readyBadgeText, { color: Theme.colors.accentSage }]}>Done</Text>
              </View>
            ) : item.status === 'active' ? (
              <View style={[styles.readyBadge, { backgroundColor: 'rgba(56, 178, 172, 0.15)' }]}>
                <Text style={[styles.readyBadgeText, { color: Theme.colors.accentTeal }]}>Active</Text>
              </View>
            ) : (
              <View style={styles.readyBadge}>
                <Text style={styles.readyBadgeText}>Ready</Text>
              </View>
            )}
          </View>

          <Text style={styles.sessionMeta}>
            {pattern.width}×{pattern.height} • {pattern.colorsCount} colors
          </Text>

          {/* Progress bar */}
          <View style={styles.progressContainer}>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${item.progress}%` }]} />
            </View>
            <Text style={styles.progressText}>{item.progress}%</Text>
          </View>
        </View>

        <View style={styles.actionColumn}>
          <Button
            title={item.status === 'completed' ? 'View' : 'Open'}
            onPress={() => handleOpenSession(item.id)}
            variant={item.status === 'completed' ? 'secondary' : 'sage'}
            style={styles.openBtn}
          />
          <Button
            title="Delete"
            onPress={() => handleDeleteSession(item.id)}
            variant="secondary"
            style={styles.deleteTextBtn}
            textStyle={styles.deleteText}
          />
        </View>
      </Card>
    );
  };

  return (
    <Screen style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Stitching Table</Text>
        <Text style={styles.subtitle}>Pick up where you left off or resume a recent craft.</Text>
      </View>

      <View style={styles.content}>
        {loading ? (
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="large" color={Theme.colors.accentTeal} />
            <Text style={styles.loadingText}>Loading your stitches...</Text>
          </View>
        ) : sessions.length === 0 ? (
          <EmptyState
            icon="play-circle-outline"
            title="No Active Crafts"
            body="Your stitching frame is currently empty. Browse the pattern catalog to find something beautiful to stitch!"
            actionLabel="Browse Catalog"
            onAction={handleStartStitching}
            actionVariant="primary"
          />
        ) : (
          <FlatList
            data={sessions}
            keyExtractor={(item) => item.id}
            renderItem={renderSessionItem}
            contentContainerStyle={styles.listContainer}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: Theme.spacing.xl,
    paddingHorizontal: Theme.spacing.lg,
    flex: 1,
  },
  header: {
    marginBottom: Theme.spacing.lg,
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
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Theme.spacing.xxl,
  },
  loadingText: {
    marginTop: Theme.spacing.md,
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
  },
  listContainer: {
    gap: Theme.spacing.md,
    paddingBottom: Theme.spacing.xxl,
  },
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Theme.spacing.md,
  },
  sessionImage: {
    width: 64,
    height: 64,
    borderRadius: Theme.radii.sm,
    backgroundColor: '#FAF6F0',
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  sessionInfo: {
    flex: 1,
    marginLeft: Theme.spacing.md,
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
  },
  sessionTitle: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textPrimary,
    flexShrink: 1,
  },
  readyBadge: {
    backgroundColor: 'rgba(122, 154, 130, 0.15)', // Sage transparent
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: Theme.radii.full,
  },
  readyBadgeText: {
    fontSize: Theme.typography.sizes.xs - 2,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.accentSage,
  },
  sessionMeta: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    marginTop: 2,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Theme.spacing.sm,
    gap: Theme.spacing.sm,
  },
  progressBarBg: {
    flex: 1,
    height: 6,
    backgroundColor: Theme.colors.disabledBackground,
    borderRadius: Theme.radii.full,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Theme.colors.accentSage,
  },
  progressText: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    fontWeight: Theme.typography.weights.medium,
  },
  actionColumn: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginLeft: Theme.spacing.md,
    gap: 4,
  },
  openBtn: {
    height: 32,
    paddingHorizontal: Theme.spacing.md,
    borderRadius: Theme.radii.sm,
  },
  deleteBtn: {
    height: 32,
    paddingHorizontal: Theme.spacing.md,
    borderRadius: Theme.radii.sm,
  },
  deleteTextBtn: {
    height: 24,
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    borderWidth: 0,
  },
  deleteText: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.error,
    fontWeight: Theme.typography.weights.medium,
  },
  unknownPatternContainer: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
