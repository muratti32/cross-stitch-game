import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, Pressable, ActivityIndicator, Image } from 'react-native';
import { Screen, EmptyState, Card, CachedImage, Button, DailyTasksCard, RewardedAdCard } from '@/components';
import { Theme } from '@/theme/theme';
import { Ionicons } from '@expo/vector-icons';
import { useIdentityStore } from '@/identity/guestIdentity';
import { useCoinBalance } from '@/api/economy';
import { shortenGuestId } from '@/identity/identityLogic';
import { useRouter } from 'expo-router';
import { listPersonalPatterns, type PersonalPattern } from '@/conversion';
import { preparePersonalSession, preparePendingPersonalSession, waitUntilSessionReady } from '@/session-preparation';
import { getPendingPersonalPatterns, type PendingPersonalPattern } from '@/local-db';
import { useCreatorProfile } from '@/api/creatorProfile';


export default function ProfileScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'my-patterns' | 'liked'>('my-patterns');
  const { guestId, guestCreatedAt, accountId, isAccount, isAuthenticated, isPending, isOfflinePending, bootstrap } = useIdentityStore();
  const { data: coinBalance } = useCoinBalance();
  const creatorProfileQuery = useCreatorProfile(accountId, isAccount && isAuthenticated && !isPending);
  const creatorProfile = creatorProfileQuery.data ?? null;
  const [personalPatterns, setPersonalPatterns] = useState<PersonalPattern[]>([]);
  const [patternsLoading, setPatternsLoading] = useState(false);
  const [openingPatternId, setOpeningPatternId] = useState<string | null>(null);
  const [patternsError, setPatternsError] = useState<string | null>(null);
  const [pendingPatterns, setPendingPatterns] = useState<PendingPersonalPattern[]>([]);
  const [openingPendingId, setOpeningPendingId] = useState<string | null>(null);

  useEffect(() => {
    if (!isAccount || activeTab !== 'my-patterns') {
      setPersonalPatterns([]);
      setPendingPatterns([]);
      return;
    }
    let active = true;
    setPatternsLoading(true);
    setPatternsError(null);
    Promise.all([listPersonalPatterns(), getPendingPersonalPatterns()])
      .then(([patterns, pending]) => {
        if (!active) return;
        setPersonalPatterns(patterns);
        // A pattern that has already synced to the backend is dropped from the
        // pending list so it is never rendered twice while this screen is
        // still mounted (the local pending_personal_patterns row is deleted by
        // the sync outbox on success, but this effect only refetches on
        // activeTab/isAccount changes, not on that background completion).
        const syncedIds = new Set(patterns.map((p) => p.id));
        setPendingPatterns(pending.filter((p) => !syncedIds.has(p.patternId)));
      })
      .catch((error: unknown) => {
        if (active) {
          setPatternsError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (active) setPatternsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeTab, isAccount]);

  const playerStats = {
    coins: coinBalance ?? 0,
    creationsCount: personalPatterns.length + pendingPatterns.length,
    completedCount: 0,
  };

  const openPersonalPattern = async (pattern: PersonalPattern) => {
    setOpeningPatternId(pattern.id);
    setPatternsError(null);
    try {
      const session = await preparePersonalSession(pattern.id, {
        height: pattern.height,
        previewUrl: pattern.previewUrl,
        title: pattern.title,
        width: pattern.width,
      });
      const ready = await waitUntilSessionReady(session.id);
      router.push(`/(tabs)/(play)/${ready.id}`);
    } catch (error: unknown) {
      setPatternsError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpeningPatternId(null);
    }
  };

  const openPendingPersonalPattern = async (pending: PendingPersonalPattern) => {
    setOpeningPendingId(pending.patternId);
    setPatternsError(null);
    try {
      const session = await preparePendingPersonalSession(pending);
      const ready = await waitUntilSessionReady(session.id);
      router.push(`/(tabs)/(play)/${ready.id}`);
    } catch (error: unknown) {
      setPatternsError(error instanceof Error ? error.message : String(error));
    } finally {
      setOpeningPendingId(null);
    }
  };

  const handleEditProfile = () => {
    router.push('/(tabs)/(profile)/public-profile');
  };

  return (
    <Screen scrollable contentContainerStyle={styles.container}>
      {/* Profile Header Card */}
      {isPending && !guestId ? (
        <View style={styles.profileCard}>
          <ActivityIndicator size="large" color={Theme.colors.accentRose} />
          <Text style={[styles.displayName, { marginTop: Theme.spacing.md }]}>Establishing identity...</Text>
        </View>
      ) : isOfflinePending && !guestId ? (
        <View style={styles.profileCard}>
          <View style={styles.avatarContainer}>
            <Ionicons name="cloud-offline-outline" size={48} color={Theme.colors.error} />
          </View>
          <Text style={styles.displayName}>Identity Pending</Text>
          <Text style={[styles.username, { color: Theme.colors.error }]}>Offline</Text>
          <Pressable onPress={() => bootstrap()} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Retry Connection</Text>
          </Pressable>
        </View>
      ) : isAccount && creatorProfileQuery.isLoading ? (
        <View style={styles.profileCard}>
          <ActivityIndicator size="large" color={Theme.colors.accentRose} />
          <Text style={styles.profileStatusText}>Loading public profile...</Text>
        </View>
      ) : isAccount && creatorProfileQuery.isError ? (
        <View style={styles.profileCard}>
          <View style={styles.avatarContainer}>
            <Ionicons name="cloud-offline-outline" size={48} color={Theme.colors.error} />
          </View>
          <Text style={styles.displayName}>Public profile unavailable</Text>
          <Text style={styles.profileHelpText}>Check your connection and try again.</Text>
          <Pressable onPress={() => void creatorProfileQuery.refetch()} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </Pressable>
        </View>
      ) : isAccount && creatorProfile === null ? (
        <View style={styles.profileCard}>
          <View style={styles.avatarContainer}>
            <Ionicons name="person-add-outline" size={44} color={Theme.colors.accentRose} />
          </View>
          <Text style={styles.displayName}>Create your public profile</Text>
          <Text style={styles.profileHelpText}>
            Choose the permanent username shown with your community patterns. Your account details stay private.
          </Text>
          <Pressable onPress={handleEditProfile} style={styles.editButton}>
            <Text style={styles.editButtonText}>Create Public Profile</Text>
          </Pressable>
        </View>
      ) : isAccount && creatorProfile !== null ? (
        <View style={styles.profileCard}>
          <View style={styles.avatarContainer}>
            {creatorProfile.avatarUrl === null ? (
              <Ionicons name="person" size={48} color={Theme.colors.accentRose} />
            ) : (
              <Image source={{ uri: creatorProfile.avatarUrl }} style={styles.avatarImage} />
            )}
          </View>

          <Text style={styles.displayName}>{creatorProfile.displayName}</Text>
          <Text style={styles.username}>@{creatorProfile.username}</Text>
          <Text style={styles.sinceText}>
            Creator since {new Date(creatorProfile.createdAt).toLocaleDateString()}
          </Text>

          <Pressable onPress={handleEditProfile} style={styles.editButton}>
            <Text style={styles.editButtonText}>Edit Public Profile</Text>
          </Pressable>

          {isOfflinePending && (
            <View style={styles.offlineBadge}>
              <Ionicons name="alert-circle-outline" size={14} color={Theme.colors.error} />
              <Text style={styles.offlineBadgeText}>Offline — pending sync</Text>
            </View>
          )}
        </View>
      ) : (
        <View style={styles.profileCard}>
          <View style={styles.avatarContainer}>
            <Ionicons name="person" size={48} color={Theme.colors.accentRose} />
          </View>
          <Text style={styles.displayName}>Guest Player</Text>
          <Text style={styles.username}>@{shortenGuestId(guestId || '')}</Text>
          {guestCreatedAt && (
            <Text style={styles.sinceText}>
              Playing since {new Date(guestCreatedAt).toLocaleDateString()}
            </Text>
          )}
          {isOfflinePending && (
            <View style={styles.offlineBadge}>
              <Ionicons name="alert-circle-outline" size={14} color={Theme.colors.error} />
              <Text style={styles.offlineBadgeText}>Offline — pending sync</Text>
            </View>
          )}
        </View>
      )}

      {/* Stats Bar */}
      <View style={styles.statsContainer}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{playerStats.coins}</Text>
          <Text style={styles.statLabel}>Stitch Coins</Text>
        </View>

        <View style={styles.statDivider} />

        <View style={styles.statBox}>
          <Text style={styles.statValue}>{playerStats.completedCount}</Text>
          <Text style={styles.statLabel}>Stitched</Text>
        </View>

        <View style={styles.statDivider} />

        <View style={styles.statBox}>
          <Text style={styles.statValue}>{playerStats.creationsCount}</Text>
          <Text style={styles.statLabel}>Creations</Text>
        </View>
      </View>

      {/* Purchase Button */}
      {isAccount && (
        <Pressable
          onPress={() => router.push('/(tabs)/(profile)/commerce')}
          style={({ pressed }) => [
            styles.purchaseButton,
            pressed && { opacity: 0.7 }
          ]}
        >
          <Ionicons name="bag-outline" size={18} color={Theme.colors.accentRose} />
          <Text style={styles.purchaseButtonText}>Get Coins & AI Credits</Text>
        </Pressable>
      )}

      {isAccount && creatorProfile !== null && (
        <Pressable
          onPress={() => router.push('/(tabs)/(profile)/submissions')}
          style={({ pressed }) => [styles.submissionsButton, pressed && styles.pressedButton]}
        >
          <Ionicons name="file-tray-full-outline" size={18} color={Theme.colors.accentTeal} />
          <View style={styles.submissionsButtonText}>
            <Text style={styles.submissionsButtonTitle}>Catalog Submissions</Text>
            <Text style={styles.submissionsButtonSubtitle}>Track reviews, decisions, and appeals</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Theme.colors.textSecondary} />
        </Pressable>
      )}

      {isAccount && creatorProfile !== null && (
        <Pressable
          onPress={() => router.push('/(tabs)/(profile)/published-patterns')}
          style={({ pressed }) => [styles.submissionsButton, pressed && styles.pressedButton]}
        >
          <Ionicons name="albums-outline" size={18} color={Theme.colors.accentTeal} />
          <View style={styles.submissionsButtonText}>
            <Text style={styles.submissionsButtonTitle}>Published Patterns</Text>
            <Text style={styles.submissionsButtonSubtitle}>Revise metadata, withdraw, and track appeals</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Theme.colors.textSecondary} />
        </Pressable>
      )}

      {isAccount && (
        <Pressable
          onPress={() => router.push('/(tabs)/(profile)/liked-patterns')}
          style={({ pressed }) => [styles.submissionsButton, pressed && styles.pressedButton]}
        >
          <Ionicons name="heart-outline" size={18} color={Theme.colors.accentTeal} />
          <View style={styles.submissionsButtonText}>
            <Text style={styles.submissionsButtonTitle}>Liked Patterns</Text>
            <Text style={styles.submissionsButtonSubtitle}>Your private collection of liked community patterns</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Theme.colors.textSecondary} />
        </Pressable>
      )}

      <DailyTasksCard enabled={isAuthenticated && !isPending && !isOfflinePending} />
      <RewardedAdCard enabled={!isPending && !isOfflinePending} />

      {/* Tab Switcher */}
      <View style={styles.tabBar}>
        <Pressable 
          onPress={() => setActiveTab('my-patterns')}
          style={[styles.tabItem, activeTab === 'my-patterns' && styles.activeTabItem]}
        >
          <Text style={[styles.tabLabel, activeTab === 'my-patterns' && styles.activeTabLabel]}>
            My Creations
          </Text>
        </Pressable>
        
        <Pressable 
          onPress={() => setActiveTab('liked')}
          style={[styles.tabItem, activeTab === 'liked' && styles.activeTabItem]}
        >
          <Text style={[styles.tabLabel, activeTab === 'liked' && styles.activeTabLabel]}>
            Liked Patterns
          </Text>
        </Pressable>
      </View>

      {/* List content / Empty States */}
      <View style={styles.content}>
        {activeTab === 'my-patterns' && !isAccount ? (
          <EmptyState
            icon="person-circle-outline"
            title="Sign in for Personal Patterns"
            body="A Registered Account is required to create and privately own converted photo patterns."
            actionLabel="Sign in"
            onAction={() => router.push('/(tabs)/(settings)/sign-in')}
            actionVariant="rose"
          />
        ) : activeTab === 'my-patterns' && patternsLoading ? (
          <View style={styles.patternLoader}>
            <ActivityIndicator color={Theme.colors.accentRose} />
          </View>
        ) : activeTab === 'my-patterns' && (personalPatterns.length > 0 || pendingPatterns.length > 0) ? (
          <View style={styles.patternList}>
            {pendingPatterns.map((pending) => (
              <Card key={pending.patternId} style={styles.patternCard}>
                <View style={[styles.patternPreview, styles.patternPendingPreview]}>
                  <Ionicons name="cloud-offline-outline" size={28} color={Theme.colors.textSecondary} />
                </View>
                <View style={styles.patternInfo}>
                  <Text style={styles.patternTitle} numberOfLines={1}>{pending.title}</Text>
                  <Text style={styles.patternMeta}>
                    {pending.width}×{pending.height} · {pending.palette.length} colors
                  </Text>
                  <View style={styles.patternPendingBadge}>
                    <Ionicons name="sync-outline" size={12} color={Theme.colors.error} />
                    <Text style={styles.patternPendingBadgeText}>Pending sync</Text>
                  </View>
                </View>
                <Button
                  title="Play"
                  variant="sage"
                  loading={openingPendingId === pending.patternId}
                  disabled={openingPendingId !== null}
                  onPress={() => void openPendingPersonalPattern(pending)}
                  style={styles.playButton}
                />
              </Card>
            ))}
            {personalPatterns.map((pattern) => (
              <Card key={pattern.id} style={styles.patternCard}>
                <CachedImage uri={pattern.previewUrl} style={styles.patternPreview} />
                <View style={styles.patternInfo}>
                  <Text style={styles.patternTitle} numberOfLines={1}>{pattern.title}</Text>
                  <Text style={styles.patternMeta}>
                    {pattern.width}×{pattern.height} · {pattern.paletteSize} colors
                  </Text>
                </View>
                <Button
                  title="Play"
                  variant="sage"
                  loading={openingPatternId === pattern.id}
                  disabled={openingPatternId !== null}
                  onPress={() => void openPersonalPattern(pattern)}
                  style={styles.playButton}
                />
                <Button
                  title="Edit"
                  variant="secondary"
                  onPress={() => router.push(`/(tabs)/(create)/pattern-editor?patternId=${pattern.id}`)}
                  style={styles.patternEditButton}
                />
                {creatorProfile !== null && (
                  <Pressable
                    accessibilityLabel={`Submit ${pattern.title} to the Community Catalog`}
                    accessibilityRole="button"
                    onPress={() => router.push(`/(tabs)/(profile)/submit-pattern?patternId=${pattern.id}`)}
                    style={({ pressed }) => [styles.patternSubmitButton, pressed && styles.pressedButton]}
                  >
                    <Ionicons name="cloud-upload-outline" size={19} color={Theme.colors.accentRose} />
                  </Pressable>
                )}
              </Card>
            ))}
            {patternsError && <Text style={styles.patternError}>{patternsError}</Text>}
          </View>
        ) : activeTab === 'my-patterns' ? (
          <EmptyState
            icon="color-palette-outline"
            title="No Personal Creations"
            body="You haven't converted any photos or generated AI art yet. Head over to the Create tab to start your first masterwork!"
            actionLabel="Start Creating"
            onAction={() => router.push('/(tabs)/(create)/photo-import')}
            actionVariant="rose"
          />
        ) : (
          <EmptyState
            icon="heart-outline"
            title="No Liked Patterns"
            body="Browse the pattern catalog and tap the heart icon on any design to save it here for later."
            actionLabel="Discover Patterns"
            onAction={() => console.log('Navigating to Catalog tab...')}
            actionVariant="sage"
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
    paddingBottom: Theme.spacing.xxl,
  },
  profileCard: {
    alignItems: 'center',
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.lg,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    padding: Theme.spacing.xl,
    marginBottom: Theme.spacing.lg,
  },
  avatarContainer: {
    width: 90,
    height: 90,
    borderRadius: Theme.radii.full,
    backgroundColor: '#FCFAF7',
    borderWidth: 1.5,
    borderColor: Theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Theme.spacing.md,
    overflow: 'hidden',
  },
  avatarImage: {
    height: '100%',
    width: '100%',
  },
  displayName: {
    fontSize: Theme.typography.sizes.lg,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  username: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    marginTop: Theme.spacing.xs,
    marginBottom: Theme.spacing.md,
  },
  editButton: {
    paddingVertical: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.lg,
    borderRadius: Theme.radii.full,
    borderWidth: 1,
    borderColor: Theme.colors.accentTeal,
  },
  editButtonText: {
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.accentTeal,
  },
  profileStatusText: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.sm,
    marginTop: Theme.spacing.md,
  },
  profileHelpText: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.sm,
    lineHeight: 20,
    marginBottom: Theme.spacing.md,
    marginTop: Theme.spacing.sm,
    textAlign: 'center',
  },
  statsContainer: {
    flexDirection: 'row',
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.lg,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    paddingVertical: Theme.spacing.md,
    marginBottom: Theme.spacing.xl,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  statBox: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontSize: Theme.typography.sizes.lg,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  statLabel: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    marginTop: Theme.spacing.xs,
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: Theme.colors.border,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1.5,
    borderBottomColor: Theme.colors.border,
    marginBottom: Theme.spacing.lg,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Theme.spacing.md,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  activeTabItem: {
    borderBottomColor: Theme.colors.accentRose,
  },
  tabLabel: {
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textSecondary,
  },
  activeTabLabel: {
    color: Theme.colors.accentRose,
  },
  content: {
    flex: 1,
  },
  patternLoader: {
    paddingVertical: Theme.spacing.xxl,
  },
  patternList: {
    gap: Theme.spacing.md,
  },
  patternCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Theme.spacing.md,
  },
  patternPreview: {
    width: 64,
    height: 64,
    borderRadius: Theme.radii.sm,
    backgroundColor: '#FAF6F0',
  },
  patternInfo: {
    flex: 1,
    marginHorizontal: Theme.spacing.md,
  },
  patternTitle: {
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  patternMeta: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    marginTop: Theme.spacing.xs,
  },
  playButton: {
    height: 36,
    paddingHorizontal: Theme.spacing.md,
  },
  patternEditButton: {
    height: 36,
    paddingHorizontal: Theme.spacing.md,
    marginLeft: Theme.spacing.sm,
  },
  patternSubmitButton: {
    alignItems: 'center',
    borderColor: Theme.colors.accentRose,
    borderRadius: Theme.radii.lg,
    borderWidth: 1.5,
    height: 36,
    justifyContent: 'center',
    marginLeft: Theme.spacing.sm,
    width: 36,
  },
  patternPendingPreview: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  patternPendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: Theme.spacing.xs,
  },
  patternPendingBadgeText: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.medium,
    color: Theme.colors.error,
  },
  patternError: {
    color: Theme.colors.error,
    fontSize: Theme.typography.sizes.sm,
  },
  sinceText: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    marginBottom: Theme.spacing.sm,
  },
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FDF2F2',
    borderWidth: 1,
    borderColor: '#FBD5D5',
    paddingVertical: Theme.spacing.xs,
    paddingHorizontal: Theme.spacing.sm,
    borderRadius: Theme.radii.sm,
    gap: Theme.spacing.xs,
    marginTop: Theme.spacing.xs,
  },
  offlineBadgeText: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.medium,
    color: Theme.colors.error,
  },
  retryButton: {
    paddingVertical: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.lg,
    borderRadius: Theme.radii.full,
    borderWidth: 1,
    borderColor: Theme.colors.error,
    marginTop: Theme.spacing.sm,
  },
  retryButtonText: {
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.error,
  },
  purchaseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.lg,
    borderWidth: 1,
    borderColor: Theme.colors.accentRose,
    paddingVertical: Theme.spacing.md,
    paddingHorizontal: Theme.spacing.lg,
    marginBottom: Theme.spacing.lg,
    gap: Theme.spacing.sm,
  },
  purchaseButtonText: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.accentRose,
  },
  submissionsButton: {
    alignItems: 'center',
    backgroundColor: Theme.colors.card,
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Theme.spacing.sm,
    marginBottom: Theme.spacing.lg,
    paddingHorizontal: Theme.spacing.lg,
    paddingVertical: Theme.spacing.md,
  },
  submissionsButtonText: {
    flex: 1,
  },
  submissionsButtonTitle: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.semibold,
  },
  submissionsButtonSubtitle: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.xs,
    marginTop: Theme.spacing.xs,
  },
  pressedButton: {
    opacity: 0.75,
  },
});
