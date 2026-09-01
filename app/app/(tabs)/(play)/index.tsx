import React, { useState, useCallback } from 'react';
import { StyleSheet, View, Text, FlatList, ActivityIndicator, Alert, Pressable, Dimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Screen, EmptyState, Card, PatternImage } from '@/components';
import { Theme } from '@/theme/theme';
import { useTabBarSpace } from '@/theme/tabBar';
import { useRouter, useFocusEffect } from 'expo-router';
import { getSessions, deleteSession, getSessionCompletedCount, StitchingSession } from '@/local-db';
import { BUNDLED_PATTERNS } from '@/bundled-patterns';
import { refreshPersonalSessionAssetUrlsBeforeRender } from '@/conversion';
import {
  cancelDownload,
  retryDownload,
  useDownloadProgressStore,
} from '@/session-preparation';
import { Ionicons } from '@expo/vector-icons';

const { width: screenWidth } = Dimensions.get('window');
// Padding horizontal is Theme.spacing.lg (16) * 2 = 32
// Gap between columns is 12
const cardWidth = (screenWidth - 32 - 12) / 2;

export default function PlayScreen() {
  const { t } = useTranslation('play');
  const router = useRouter();
  const tabBarSpace = useTabBarSpace();
  const [sessions, setSessions] = useState<(StitchingSession & { progress: number })[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSessionsList = async () => {
    try {
      const data = await getSessions();
      const sessionsWithProgress = await Promise.all(
        data.map(async (sess) => {
          const pattern = BUNDLED_PATTERNS.find((p) => p.id === sess.patternId);
          const width = pattern?.width ?? sess.patternWidth ?? 0;
          const height = pattern?.height ?? sess.patternHeight ?? 0;
          if (width === 0 || height === 0 || sess.status === 'preparing') {
            return { ...sess, progress: 0 };
          }
          const completedCount = await getSessionCompletedCount(sess.id, width, height);
          const totalCount = pattern?.cellsCount || width * height;
          const progress = totalCount > 0 ? Math.floor((completedCount / totalCount) * 100) : 0;
          return {
            ...sess,
            progress,
          };
        })
      );
      // Personal Pattern image urls are short-lived signed grants, so the copy
      // stored at Session Preparation time is usually expired by the time the
      // card is rendered again. Refresh before the first visible list update,
      // avoiding a stale-url render followed by a second image load. Offline
      // devices keep whatever they already cached.
      const displaySessions = await refreshPersonalSessionAssetUrlsBeforeRender(
        sessionsWithProgress,
        (err) => console.warn('Failed to refresh personal pattern image urls:', err),
      );
      setSessions(displaySessions);
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

  const handleConfirmDeleteSession = (sessionId: string, title: string) => {
    Alert.alert(
      t('home.deleteConfirm.title'),
      t('home.deleteConfirm.message', { title }),
      [
        { text: t('home.deleteConfirm.cancel'), style: 'cancel' },
        {
          text: t('home.deleteConfirm.confirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteSession(sessionId);
              await loadSessionsList();
            } catch (err) {
              console.error('Failed to delete session:', err);
            }
          },
        },
      ]
    );
  };

  const renderSessionItem = ({ item }: { item: StitchingSession & { progress: number } }) => {
    const pattern = BUNDLED_PATTERNS.find((p) => p.id === item.patternId);
    const displayTitle = pattern?.title ?? item.title ?? t('home.unknownPattern');
    const displayWidth = pattern?.width ?? item.patternWidth ?? 0;
    const displayHeight = pattern?.height ?? item.patternHeight ?? 0;

    if (!pattern && !item.title) {
      return (
        <Card style={styles.sessionCard}>
          <View style={[styles.sessionImage, styles.placeholderImageContainer, { height: 110 }]}>
            <Ionicons name="help-circle-outline" size={32} color={Theme.colors.textSecondary} />
          </View>
          <View style={styles.sessionDetailsContainer}>
            <Text style={styles.sessionTitle} numberOfLines={1}>
              {t('home.unknownPattern')}
            </Text>
            <Text style={styles.sessionMeta}>{t('home.idLabel', { id: item.patternId })}</Text>
          </View>
          <Pressable
            onPress={() => handleConfirmDeleteSession(item.id, t('home.unknownPatternLabel', { id: item.patternId }))}
            style={({ pressed }) => [
              styles.deleteIconButton,
              pressed && styles.deleteIconButtonPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('home.deleteSessionAccessibilityLabel')}
          >
            <Ionicons name="trash-outline" size={15} color={Theme.colors.error} />
          </Pressable>
        </Card>
      );
    }

    if (item.status === 'preparing') {
      return (
        <PreparingSessionCard
          session={item}
          title={displayTitle}
          onChanged={loadSessionsList}
        />
      );
    }

    // Determine badge and bar styling based on status
    let badgeBg = 'rgba(133, 125, 117, 0.1)';
    let badgeText = Theme.colors.textSecondary;
    let badgeLabel = t('home.status.ready');
    let progressFillColor = Theme.colors.accentSage;

    if (item.status === 'completed') {
      badgeBg = 'rgba(122, 154, 130, 0.15)';
      badgeText = Theme.colors.accentSage;
      badgeLabel = t('home.status.done');
      progressFillColor = Theme.colors.accentSage;
    } else if (item.status === 'active') {
      badgeBg = 'rgba(44, 94, 101, 0.12)';
      badgeText = Theme.colors.accentTeal;
      badgeLabel = t('home.status.active');
      progressFillColor = Theme.colors.accentTeal;
    }

    return (
      <Card style={styles.sessionCard} onPress={() => handleOpenSession(item.id)}>
        <View style={styles.imageWrapper}>
          <PatternImage
            assets={{
              thumbnailUrls: item.thumbnailUrl
                ? { browsing: item.thumbnailUrl, detail: item.thumbnailUrl }
                : null,
              previewUrl: item.previewUrl,
            }}
            variant="browsing"
            localAsset={pattern?.previewAsset}
            localThumbnailAsset={pattern?.thumbnailAsset}
            style={styles.sessionImage}
          />

          {/* Absolute Trash Icon Button in top right of image */}
          <Pressable
            onPress={() => handleConfirmDeleteSession(item.id, displayTitle)}
            style={({ pressed }) => [
              styles.deleteIconButton,
              pressed && styles.deleteIconButtonPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={t('home.deleteSessionAccessibilityLabel')}
          >
            <Ionicons name="trash-outline" size={15} color={Theme.colors.error} />
          </Pressable>

          {/* Play/View Button overlaying bottom-right of image */}
          <Pressable
            onPress={() => handleOpenSession(item.id)}
            style={({ pressed }) => [
              styles.imageActionBtn,
              item.status === 'completed' ? styles.imageActionBtnCompleted : styles.imageActionBtnActive,
              pressed && styles.imageActionBtnPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={item.status === 'completed' ? t('home.viewFinishedAccessibilityLabel') : t('home.resumeAccessibilityLabel')}
          >
            <Ionicons
              name={item.status === 'completed' ? 'eye-outline' : 'play'}
              size={14}
              color={item.status === 'completed' ? Theme.colors.accentSage : '#FFFFFF'}
              style={item.status !== 'completed' ? { marginLeft: 1 } : undefined}
            />
          </Pressable>
        </View>

        <View style={styles.sessionDetailsContainer}>
          <Text style={styles.sessionTitle} numberOfLines={1}>
            {displayTitle}
          </Text>

          <View style={styles.metaRow}>
            <Text style={styles.sessionMeta}>
              {displayWidth}×{displayHeight}
            </Text>
            <View style={[styles.readyBadge, { backgroundColor: badgeBg }]}>
              <Text style={[styles.readyBadgeText, { color: badgeText }]}>{badgeLabel}</Text>
            </View>
          </View>

          {/* Progress bar */}
          <View style={styles.progressContainer}>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${item.progress}%`, backgroundColor: progressFillColor }]} />
            </View>
            <Text style={styles.progressText}>{item.progress}%</Text>
          </View>
        </View>
      </Card>
    );
  };

  const header = (
    <View style={styles.header}>
      <Text style={styles.title}>{t('home.title')}</Text>
      <Text style={styles.subtitle}>{t('home.subtitle')}</Text>
    </View>
  );

  return (
    <Screen style={styles.container} clearsTabBar={false}>
      {loading ? (
        <>
          {header}
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="large" color={Theme.colors.accentTeal} />
            <Text style={styles.loadingText}>{t('home.loading')}</Text>
          </View>
        </>
      ) : sessions.length === 0 ? (
        <>
          {header}
          <View style={styles.sectionPadding}>
            <EmptyState
              icon="play-circle-outline"
              title={t('home.empty.title')}
              body={t('home.empty.body')}
              actionLabel={t('home.empty.action')}
              onAction={handleStartStitching}
              actionVariant="primary"
            />
          </View>
        </>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={renderSessionItem}
          numColumns={2}
          ListHeaderComponent={header}
          columnWrapperStyle={styles.columnWrapper}
          contentContainerStyle={[styles.listContainer, { paddingBottom: tabBarSpace }]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </Screen>
  );
}

function PreparingSessionCard({
  session,
  title,
  onChanged,
}: {
  session: StitchingSession;
  title: string;
  onChanged: () => void;
}) {
  const { t } = useTranslation('play');
  const progress = useDownloadProgressStore(
    (state) => state.progress[session.id] ?? 0,
  );
  const [busy, setBusy] = useState(false);
  const failed = !!session.errorNote;

  const handleCancelOrDelete = () => {
    Alert.alert(
      failed ? t('home.preparingCard.discardTitle') : t('home.preparingCard.cancelTitle'),
      failed
        ? t('home.preparingCard.discardMessage')
        : t('home.preparingCard.cancelMessage'),
      [
        { text: t('home.preparingCard.keep'), style: 'cancel' },
        {
          text: failed ? t('home.preparingCard.discard') : t('home.preparingCard.cancel'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                if (failed) {
                  await deleteSession(session.id);
                } else {
                  await cancelDownload(session.id);
                }
              } finally {
                setBusy(false);
                onChanged();
              }
            })();
          },
        },
      ]
    );
  };

  return (
    <Card style={styles.sessionCard}>
      <View style={styles.imageWrapper}>
        <PatternImage
          assets={{
            thumbnailUrls: session.thumbnailUrl
              ? { browsing: session.thumbnailUrl, detail: session.thumbnailUrl }
              : null,
            previewUrl: session.previewUrl,
          }}
          variant="browsing"
          style={styles.sessionImage}
        />

        {/* Cancel/Discard Button in top right */}
        <Pressable
          onPress={handleCancelOrDelete}
          disabled={busy}
          style={({ pressed }) => [
            styles.deleteIconButton,
            pressed && styles.deleteIconButtonPressed,
          ]}
        >
          <Ionicons
            name={failed ? 'trash-outline' : 'close-outline'}
            size={16}
            color={failed ? Theme.colors.error : Theme.colors.textSecondary}
          />
        </Pressable>

        {/* Retry Button in bottom right if failed */}
        {failed && (
          <Pressable
            onPress={() => {
              void (async () => {
                setBusy(true);
                try {
                  await retryDownload(session.id);
                } catch {
                  // error note already persisted by retryDownload
                } finally {
                  setBusy(false);
                  onChanged();
                }
              })();
            }}
            disabled={busy}
            style={({ pressed }) => [
              styles.imageActionBtn,
              styles.imageActionBtnActive,
              pressed && styles.imageActionBtnPressed,
            ]}
          >
            <Ionicons name="refresh" size={14} color="#FFFFFF" />
          </Pressable>
        )}
      </View>

      <View style={styles.sessionDetailsContainer}>
        <Text style={styles.sessionTitle} numberOfLines={1}>
          {title}
        </Text>

        <View style={styles.metaRow}>
          <Text style={styles.sessionMeta}>
            {session.patternWidth && session.patternHeight
              ? `${session.patternWidth}×${session.patternHeight}`
              : t('home.status.preparing')}
          </Text>
          <View
            style={[
              styles.readyBadge,
              {
                backgroundColor: failed
                  ? 'rgba(211, 93, 93, 0.12)'
                  : 'rgba(212, 163, 92, 0.15)',
              },
            ]}
          >
            <Text
              style={[
                styles.readyBadgeText,
                { color: failed ? Theme.colors.error : Theme.colors.accentHoney },
              ]}
            >
              {failed ? t('home.status.failed') : t('home.status.preparing')}
            </Text>
          </View>
        </View>

        {failed ? (
          <Text style={styles.preparingErrorText} numberOfLines={1}>
            {session.errorNote}
          </Text>
        ) : (
          <View style={styles.progressContainer}>
            <View style={styles.progressBarBg}>
              <View
                style={[
                  styles.progressBarFill,
                  {
                    width: `${Math.round(progress * 100)}%`,
                    backgroundColor: Theme.colors.accentHoney,
                  },
                ]}
              />
            </View>
            <Text style={styles.progressText}>
              {Math.round(progress * 100)}%
            </Text>
          </View>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: Theme.spacing.xl,
    flex: 1,
  },
  header: {
    paddingHorizontal: Theme.spacing.lg,
    marginBottom: Theme.spacing.md,
  },
  title: {
    fontSize: Theme.typography.sizes.xxxl,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.accentRose,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    marginTop: Theme.spacing.xs,
  },
  sectionPadding: {
    paddingHorizontal: Theme.spacing.lg,
  },
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.lg,
    paddingVertical: Theme.spacing.xxl,
  },
  loadingText: {
    marginTop: Theme.spacing.md,
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
  },
  listContainer: {
    paddingBottom: Theme.spacing.xxl,
  },
  columnWrapper: {
    justifyContent: 'space-between',
    paddingHorizontal: Theme.spacing.lg,
  },
  sessionCard: {
    width: cardWidth,
    marginBottom: 16,
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.lg,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    overflow: 'hidden',
    position: 'relative',
    // shadow
    shadowColor: '#2E2A25',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  imageWrapper: {
    width: '100%',
    height: 110,
    position: 'relative',
    overflow: 'hidden',
  },
  sessionImage: {
    width: '100%',
    height: '100%',
  },
  placeholderImageContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FAF6F0',
  },
  sessionDetailsContainer: {
    padding: 10,
  },
  sessionTitle: {
    fontSize: 14,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textPrimary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  sessionMeta: {
    fontSize: 11,
    color: Theme.colors.textSecondary,
  },
  readyBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: Theme.radii.full,
  },
  readyBadgeText: {
    fontSize: 9,
    fontWeight: Theme.typography.weights.bold,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 6,
  },
  progressBarBg: {
    flex: 1,
    height: 4,
    backgroundColor: Theme.colors.disabledBackground,
    borderRadius: Theme.radii.full,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: Theme.radii.full,
  },
  progressText: {
    fontSize: 10,
    color: Theme.colors.textSecondary,
    fontWeight: Theme.typography.weights.medium,
  },
  deleteIconButton: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  deleteIconButtonPressed: {
    backgroundColor: 'rgba(255, 255, 255, 1)',
    transform: [{ scale: 0.95 }],
  },
  imageActionBtn: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  imageActionBtnActive: {
    backgroundColor: Theme.colors.accentTeal,
  },
  imageActionBtnCompleted: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderWidth: 1,
    borderColor: Theme.colors.accentSage,
  },
  imageActionBtnPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.95 }],
  },
  preparingErrorText: {
    fontSize: 10,
    color: Theme.colors.error,
    marginTop: 4,
  },
});
