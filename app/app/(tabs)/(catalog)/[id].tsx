import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, ActivityIndicator, ScrollView, Alert, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen, Button, Card, PatternImage, CommunityReportAction, EmptyState, GuestDataRiskNotice } from '@/components';
import { Theme } from '@/theme/theme';
import { BUNDLED_PATTERNS, loadBundledPattern } from '@/bundled-patterns';
import { PatternData } from '@/pattern-artifact';
import { absolutePreviewUrl, absoluteThumbnailUrls, useCatalogPattern } from '@/api/catalog';
import { useIdentityStore } from '@/identity/guestIdentity';
import { prepareCatalogSession, prepareBundledSession, UnlockRequiredError } from '@/session-preparation';
import { useCoinBalance, useUnlockedPatternIds, useUnlockPattern, InsufficientCoinError, unlockPriceForTier } from '@/api/economy';
import { hasSeenGuestDataRiskNotice, markGuestDataRiskNoticeSeen } from '@/local-db';
import { Ionicons } from '@expo/vector-icons';
import { useLikeToggle, useLocalLikes, useBlockCreator } from '@/api/social';

export default function PatternDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [patternData, setPatternData] = useState<PatternData | null>(null);
  const [stitching, setStitching] = useState(false);

  const manifestPattern = BUNDLED_PATTERNS.find((p) => p.id === id);

  const loadData = async () => {
    if (!id || !manifestPattern) return;
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

  // Server catalog patterns are browsable only in this slice; Session
  // Preparation (issue #12) adds the download-and-play path.
  if (!manifestPattern) {
    return <ServerPatternDetail id={id} />;
  }

  const handleStartStitching = async () => {
    try {
      setStitching(true);
      // Resumes the pattern's active session if one exists, otherwise creates one.
      const session = await prepareBundledSession(manifestPattern.id, manifestPattern.checksum);
      // Jump straight into stitching instead of the Play tab list
      router.navigate(`/(tabs)/(play)/${session.id}`);
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
        <PatternImage assets={{}} variant="detail" localAsset={manifestPattern.previewAsset} style={styles.previewImage} />
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

function ServerPatternDetail({ id }: { id: string | undefined }) {
  const router = useRouter();
  const pattern = useCatalogPattern(id, true);
  const { isAuthenticated, isAccount } = useIdentityStore();
  const isGuest = isAuthenticated && !isAccount;

  const { data: balance, isLoading: balanceLoading } = useCoinBalance();
  const { data: unlockedIds, isLoading: unlocksLoading } = useUnlockedPatternIds();
  const unlockMutation = useUnlockPattern();

  const { data: localLikes } = useLocalLikes();
  const toggleLike = useLikeToggle();
  const blockMutation = useBlockCreator();

  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [insufficientError, setInsufficientError] = useState<{ price: number; balance: number } | null>(null);
  const [unlockCTAOverride, setUnlockCTAOverride] = useState(false);

  if (pattern.isLoading) {
    return (
      <Screen style={styles.errorContainer}>
        <ActivityIndicator size="large" color={Theme.colors.accentTeal} />
      </Screen>
    );
  }

  if (pattern.isError || !pattern.data) {
    return (
      <Screen style={styles.errorContainer}>
        <EmptyState
          icon="cloud-offline-outline"
          title="Pattern Unavailable"
          body="This pattern could not be loaded. It may have been removed, or you may be offline."
          actionLabel="Go Back"
          onAction={() => router.back()}
          actionVariant="secondary"
        />
      </Screen>
    );
  }

  const item = pattern.data.data;
  const tier = item.unlockPriceTier;
  const price = tier ? unlockPriceForTier(tier) : 0;
  const owned = (tier === null || (unlockedIds ?? []).includes(item.id)) && !unlockCTAOverride;

  const isLiked = isAccount ? item.viewerLiked : !!localLikes?.[item.id];

  const handleLikeTap = () => {
    toggleLike.mutate(
      {
        patternId: item.id,
        currentLiked: isLiked,
        currentLikeCount: item.likeCount,
      },
      {
        onError: (err) => {
          setPrepareError(err instanceof Error ? err.message : 'Failed to update like status');
        },
      }
    );
  };

  const handleBlockPress = () => {
    Alert.alert(
      'Block Creator',
      `Are you sure you want to block ${item.creatorName}? This is a private, reversible action that hides their patterns from search/browse. It does not report the creator and will not interrupt your current stitching session.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block',
          style: 'destructive',
          onPress: async () => {
            if (item.creatorProfileId) {
              try {
                await blockMutation.mutateAsync(item.creatorProfileId);
                Alert.alert('Blocked', `${item.creatorName} has been blocked.`);
              } catch (err) {
                Alert.alert('Error', err instanceof Error ? err.message : 'Failed to block creator.');
              }
            }
          },
        },
      ]
    );
  };

  const handleStartStitching = async () => {
    try {
      setPreparing(true);
      setPrepareError(null);
      const session = await prepareCatalogSession(item.id, {
        title: item.title,
        previewUrl: absolutePreviewUrl(item.previewUrl),
        thumbnailUrl: absoluteThumbnailUrls(item.thumbnailUrls)?.browsing ?? null,
        width: item.width,
        height: item.height,
      });
      router.navigate(`/(tabs)/(play)/${session.id}`);
    } catch (err) {
      if (err instanceof UnlockRequiredError) {
        setUnlockCTAOverride(true);
      } else {
        setPrepareError(
          err instanceof Error
            ? err.message
            : 'Could not start preparation. Check your connection and try again.',
        );
      }
    } finally {
      setPreparing(false);
    }
  };

  const executeUnlock = async () => {
    try {
      setPreparing(true);
      setPrepareError(null);
      setInsufficientError(null);
      await unlockMutation.mutateAsync(item.id);
      setUnlockCTAOverride(false);
      
      const session = await prepareCatalogSession(item.id, {
        title: item.title,
        previewUrl: absolutePreviewUrl(item.previewUrl),
        thumbnailUrl: absoluteThumbnailUrls(item.thumbnailUrls)?.browsing ?? null,
        width: item.width,
        height: item.height,
      });
      router.navigate(`/(tabs)/(play)/${session.id}`);
    } catch (err) {
      if (err instanceof InsufficientCoinError) {
        setInsufficientError({ price: err.price, balance: err.balance });
      } else {
        setPrepareError(
          err instanceof Error
            ? err.message
            : 'Unlock failed. Check your connection and try again.'
        );
      }
    } finally {
      setPreparing(false);
    }
  };

  const handleUnlockTap = async () => {
    setPrepareError(null);
    setInsufficientError(null);
    if (isGuest) {
      const hasSeen = await hasSeenGuestDataRiskNotice();
      if (!hasSeen) {
        setNoticeVisible(true);
        return;
      }
    }
    await executeUnlock();
  };

  return (
    <Screen scrollable contentContainerStyle={styles.container}>
      <View style={styles.headerRow}>
        <Button
          variant="secondary"
          title="← Back"
          onPress={() => router.back()}
          style={styles.backButton}
        />
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={handleLikeTap} style={styles.likeHeaderButton} activeOpacity={0.7}>
            <Ionicons
              name={isLiked ? 'heart' : 'heart-outline'}
              size={24}
              color={isLiked ? Theme.colors.error : Theme.colors.textSecondary}
            />
            <Text style={styles.likeCountText}>{item.likeCount}</Text>
          </TouchableOpacity>
          
          {item.creatorProfileId && isAccount && (
            <TouchableOpacity onPress={handleBlockPress} style={styles.blockHeaderButton} activeOpacity={0.7}>
              <Ionicons
                name="ellipsis-horizontal"
                size={24}
                color={Theme.colors.textSecondary}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.imageContainer}>
        <PatternImage
          assets={{
            thumbnailUrls: absoluteThumbnailUrls(item.thumbnailUrls),
            previewUrl: absolutePreviewUrl(item.previewUrl),
          }}
          variant="detail"
          style={styles.previewImage}
        />
      </View>

      <View style={styles.infoSection}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{item.title}</Text>
          {item.unlockPriceTier && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{item.unlockPriceTier.toUpperCase()}</Text>
            </View>
          )}
        </View>
        <Text style={styles.description}>
          by {item.creatorName}{item.creatorUsername ? ` · @${item.creatorUsername}` : ''}
        </Text>
        {item.description ? <Text style={styles.catalogDescription}>{item.description}</Text> : null}
        {item.sourceLanguage ? (
          <Text style={styles.sourceLanguage}>
            Source language: {item.sourceLanguage === 'en' ? 'English' : item.sourceLanguage}
          </Text>
        ) : null}
      </View>

      <Card style={styles.specsCard}>
        <View style={styles.specItem}>
          <Text style={styles.specLabel}>Dimensions</Text>
          <Text style={styles.specValue}>
            {item.width} × {item.height}
          </Text>
        </View>
        <View style={styles.specDivider} />
        <View style={styles.specItem}>
          <Text style={styles.specLabel}>Colors</Text>
          <Text style={styles.specValue}>{item.paletteSize} Threads</Text>
        </View>
        <View style={styles.specDivider} />
        <View style={styles.specItem}>
          <Text style={styles.specLabel}>Category</Text>
          <Text style={styles.specValue}>{item.categoryCode}</Text>
        </View>
      </Card>

      {item.tags.length > 0 && (
        <View style={styles.serverTagRow}>
          {item.tags.map((tag) => (
            <View key={tag.code} style={styles.serverTagChip}>
              <Text style={styles.serverTagText}>#{tag.label}</Text>
            </View>
          ))}
        </View>
      )}

      {item.creatorProfileId ? (
        <CommunityReportAction patternId={item.id} patternTitle={item.title} />
      ) : null}

      {(prepareError || toggleLike.error) && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>
            {prepareError || toggleLike.error?.message || 'Failed to update like status'}
          </Text>
        </View>
      )}

      {isAuthenticated ? (
        <View style={styles.actionContainer}>
          {insufficientError ? (
            <Card style={styles.insufficientPanel}>
              <Text style={styles.insufficientTitle}>Insufficient Coins</Text>
              <Text style={styles.insufficientBody}>
                This pattern costs {insufficientError.price} Stitch Coins, but you only have {insufficientError.balance} Coins.
                {"\n\n"}
                Shortfall: {insufficientError.price - insufficientError.balance} Coins.
                {"\n\n"}
                Earn Stitch Coins by completing other patterns! First Completion rewards are live.
              </Text>
              <Button
                title="Find patterns to stitch"
                onPress={() => router.navigate('/(tabs)/(catalog)')}
                variant="primary"
                style={styles.actionButton}
              />
              <Button
                title="Back"
                onPress={() => setInsufficientError(null)}
                variant="secondary"
                style={[styles.actionButton, { marginTop: Theme.spacing.sm }]}
              />
            </Card>
          ) : owned ? (
            <Button
              title={preparing ? 'Preparing…' : 'Start Stitching'}
              onPress={handleStartStitching}
              variant="primary"
              loading={preparing || unlocksLoading}
              disabled={unlocksLoading || preparing}
              style={styles.actionButton}
            />
          ) : (
            <Card style={styles.unlockCard}>
              <View style={styles.coinRow}>
                <View style={styles.priceContainer}>
                  <Text style={styles.priceLabel}>Price</Text>
                  <Text style={styles.priceText}>{price} 🪙</Text>
                </View>
                <View style={styles.balanceContainer}>
                  <Text style={styles.balanceLabel}>Your Balance</Text>
                  <Text style={styles.balanceText}>
                    {balanceLoading ? '...' : `${balance ?? 0} 🪙`}
                  </Text>
                </View>
              </View>
              <Button
                title={`Unlock for ${price} Coin`}
                onPress={handleUnlockTap}
                variant="primary"
                loading={unlockMutation.isPending || preparing}
                disabled={unlocksLoading || balanceLoading || unlockMutation.isPending || preparing}
                style={styles.actionButton}
              />
            </Card>
          )}
        </View>
      ) : (
        <Card style={styles.playSoonCard}>
          <Text style={styles.playSoonTitle}>Connect to play</Text>
          <Text style={styles.playSoonBody}>
            Starting a catalog pattern needs a connection to prepare your
            session. Starter Patterns are playable right now, even offline.
          </Text>
        </Card>
      )}

      <GuestDataRiskNotice
        visible={noticeVisible}
        onProceed={async () => {
          await markGuestDataRiskNoticeSeen();
          setNoticeVisible(false);
          await executeUnlock();
        }}
        onSignIn={() => {
          setNoticeVisible(false);
          router.push('/(tabs)/(settings)/sign-in');
        }}
        onDismiss={() => {
          setNoticeVisible(false);
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Theme.spacing.lg,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.xxl,
  },
  serverTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Theme.spacing.sm,
    marginBottom: Theme.spacing.xl,
  },
  serverTagChip: {
    paddingVertical: Theme.spacing.xs,
    paddingHorizontal: Theme.spacing.md,
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.full,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  serverTagText: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.accentTeal,
    fontWeight: Theme.typography.weights.medium,
  },
  playSoonCard: {
    padding: Theme.spacing.lg,
    alignItems: 'center',
  },
  playSoonTitle: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
    marginBottom: Theme.spacing.xs,
  },
  playSoonBody: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.md,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.md,
  },
  likeHeaderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.xs,
    padding: Theme.spacing.xs,
  },
  likeCountText: {
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textSecondary,
  },
  blockHeaderButton: {
    padding: Theme.spacing.xs,
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
  catalogDescription: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.sm,
    lineHeight: 21,
    marginTop: Theme.spacing.md,
  },
  sourceLanguage: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.xs,
    marginTop: Theme.spacing.sm,
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
  insufficientPanel: {
    padding: Theme.spacing.lg,
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.lg,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  insufficientTitle: {
    fontSize: Theme.typography.sizes.lg,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.error,
    marginBottom: Theme.spacing.sm,
    textAlign: 'center',
  },
  insufficientBody: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    lineHeight: 20,
    marginBottom: Theme.spacing.lg,
    textAlign: 'center',
  },
  unlockCard: {
    padding: Theme.spacing.lg,
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.lg,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  coinRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Theme.spacing.lg,
    backgroundColor: Theme.colors.background,
    borderRadius: Theme.radii.md,
    padding: Theme.spacing.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  priceContainer: {
    alignItems: 'flex-start',
  },
  balanceContainer: {
    alignItems: 'flex-end',
  },
  priceLabel: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    marginBottom: 4,
  },
  priceText: {
    fontSize: Theme.typography.sizes.lg,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  balanceLabel: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    marginBottom: 4,
  },
  balanceText: {
    fontSize: Theme.typography.sizes.lg,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.accentTeal,
  },
});
