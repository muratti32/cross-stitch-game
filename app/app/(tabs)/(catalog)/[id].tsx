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
import { isServerApiError, localizeServerError } from '@/api/localizeServerError';
import { useTranslation } from 'react-i18next';
import { SourceLanguageBadge } from '@/components/SourceLanguageBadge';
import { formatNumber } from '@/i18n';

export default function PatternDetailScreen() {
  const { t, i18n: i18nInstance } = useTranslation('catalog');
  const locale = i18nInstance.language;
  const { id, returnTo } = useLocalSearchParams<{ id: string; returnTo?: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [patternData, setPatternData] = useState<PatternData | null>(null);
  const [stitching, setStitching] = useState(false);

  const manifestPattern = BUNDLED_PATTERNS.find((p) => p.id === id);

  const handleBack = () => {
    if (returnTo) {
      router.navigate(returnTo as any);
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.navigate('/(tabs)/(catalog)');
    }
  };

  const loadData = async () => {
    if (!id || !manifestPattern) return;
    setLoading(true);
    setError(null);
    try {
      const data = await loadBundledPattern(id);
      setPatternData(data);
    } catch (err) {
      console.error('Failed to load pattern artifact:', err);
      setError(t('detail.loadFailedGeneric'));
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
    return <ServerPatternDetail id={id} returnTo={returnTo} />;
  }

  const handleStartStitching = async () => {
    try {
      setStitching(true);
      // Resumes the pattern's active session if one exists, otherwise creates one.
      const session = await prepareBundledSession(manifestPattern.id, manifestPattern.checksum);
      // Jump straight into stitching, returning back to this catalog detail screen on exit
      const detailReturnTo = returnTo
        ? `/(tabs)/(catalog)/${id}?returnTo=${encodeURIComponent(returnTo)}`
        : `/(tabs)/(catalog)/${id}`;
      router.navigate({
        pathname: '/(tabs)/(play)/[sessionId]',
        params: { sessionId: session.id, returnTo: detailReturnTo },
      });
    } catch (err) {
      console.error('Failed to start stitching session:', err);
      setError(t('detail.sessionCreateFailed'));
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
          title={t('common.back')}
          onPress={handleBack}
          style={styles.backButton}
        />
      </View>

      {/* Pattern Visual Preview */}
      <View style={styles.imageContainer}>
        <PatternImage assets={{}} variant="detail" localAsset={manifestPattern.thumbnailAsset} style={styles.previewImage} />
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
          {manifestPattern.description || t('detail.noDescription')}
        </Text>
      </View>

      {/* Technical Specs */}
      <Card style={styles.specsCard}>
        <View style={styles.specItem}>
          <Text style={styles.specLabel}>{t('detail.specs.dimensions')}</Text>
          <Text style={styles.specValue}>
            {manifestPattern.width} × {manifestPattern.height}
          </Text>
        </View>
        <View style={styles.specDivider} />
        <View style={styles.specItem}>
          <Text style={styles.specLabel}>{t('detail.specs.totalStitches')}</Text>
          <Text style={styles.specValue}>{formatNumber(manifestPattern.cellsCount, locale)}</Text>
        </View>
        <View style={styles.specDivider} />
        <View style={styles.specItem}>
          <Text style={styles.specLabel}>{t('detail.specs.colors')}</Text>
          <Text style={styles.specValue}>{t('detail.threadsSuffix', { count: manifestPattern.colorsCount })}</Text>
        </View>
      </Card>

      {/* Thread Palette Section */}
      <View style={styles.paletteSection}>
        <Text style={styles.sectionTitle}>{t('detail.palette.title')}</Text>
        {loading ? (
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="small" color={Theme.colors.accentTeal} />
            <Text style={styles.loadingText}>{t('detail.palette.loading')}</Text>
          </View>
        ) : error ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{t('detail.palette.loadFailed', { error })}</Text>
            <Button title={t('detail.palette.retry')} onPress={loadData} variant="rose" style={styles.retryButton} />
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
          title={stitching ? t('detail.actions.starting') : t('detail.actions.startStitching')}
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

function ServerPatternDetail({ id, returnTo }: { id: string | undefined; returnTo?: string }) {
  const { t, i18n: i18nInstance } = useTranslation('catalog');
  const locale = i18nInstance.language;
  const router = useRouter();
  const pattern = useCatalogPattern(id, true);
  const { isAuthenticated, isAccount } = useIdentityStore();
  const isGuest = isAuthenticated && !isAccount;

  const handleBack = () => {
    if (returnTo) {
      router.navigate(returnTo as any);
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.navigate('/(tabs)/(catalog)');
    }
  };

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
          title={t('detail.unavailable.title')}
          body={t('detail.unavailable.body')}
          actionLabel={t('detail.unavailable.goBack')}
          onAction={handleBack}
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
          // #159: SocialApiError's server-supplied `message` never reaches
          // the player; its `reason` maps to localized text instead.
          setPrepareError(
            isServerApiError(err) ? localizeServerError(err) : t('detail.likeFailedGeneric'),
          );
        },
      }
    );
  };

  const handleBlockPress = () => {
    Alert.alert(
      t('detail.blockConfirm.title'),
      t('detail.blockConfirm.message', { creatorName: item.creatorName }),
      [
        { text: t('detail.blockConfirm.cancel'), style: 'cancel' },
        {
          text: t('detail.blockConfirm.confirm'),
          style: 'destructive',
          onPress: async () => {
            if (item.creatorProfileId) {
              try {
                await blockMutation.mutateAsync(item.creatorProfileId);
                Alert.alert(t('detail.blockConfirm.blockedTitle'), t('detail.blockConfirm.blockedMessage', { creatorName: item.creatorName }));
              } catch (err) {
                Alert.alert(t('detail.blockConfirm.errorTitle'), isServerApiError(err) ? localizeServerError(err) : t('detail.blockConfirm.failedGeneric'));
              }
            }
          },
        },
      ]
    );
  };

  const detailReturnTo = returnTo
    ? `/(tabs)/(catalog)/${id}?returnTo=${encodeURIComponent(returnTo)}`
    : `/(tabs)/(catalog)/${id}`;

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
      router.navigate({
        pathname: '/(tabs)/(play)/[sessionId]',
        params: { sessionId: session.id, returnTo: detailReturnTo },
      });
    } catch (err) {
      if (err instanceof UnlockRequiredError) {
        setUnlockCTAOverride(true);
      } else {
        setPrepareError(
          isServerApiError(err) ? localizeServerError(err) : t('detail.preparationFailedGeneric'),
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
      router.navigate({
        pathname: '/(tabs)/(play)/[sessionId]',
        params: { sessionId: session.id, returnTo: detailReturnTo },
      });
    } catch (err) {
      if (err instanceof InsufficientCoinError) {
        setInsufficientError({ price: err.price, balance: err.balance });
      } else {
        setPrepareError(
          isServerApiError(err) ? localizeServerError(err) : t('detail.unlockFailedGeneric'),
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
          title={t('common.back')}
          onPress={handleBack}
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
          {item.creatorUsername
            ? t('detail.byCreatorWithUsername', { creatorName: item.creatorName, username: item.creatorUsername })
            : t('detail.byCreator', { creatorName: item.creatorName })}
        </Text>
        {item.description ? <Text style={styles.catalogDescription}>{item.description}</Text> : null}
        {item.sourceLanguage ? (
          <SourceLanguageBadge sourceLanguage={item.sourceLanguage} style={styles.sourceLanguage} />
        ) : null}
      </View>

      <Card style={styles.specsCard}>
        <View style={styles.specItem}>
          <Text style={styles.specLabel}>{t('detail.specs.dimensions')}</Text>
          <Text style={styles.specValue}>
            {item.width} × {item.height}
          </Text>
        </View>
        <View style={styles.specDivider} />
        <View style={styles.specItem}>
          <Text style={styles.specLabel}>{t('detail.specs.colors')}</Text>
          <Text style={styles.specValue}>{t('detail.threadsSuffix', { count: item.paletteSize })}</Text>
        </View>
        <View style={styles.specDivider} />
        <View style={styles.specItem}>
          <Text style={styles.specLabel}>{t('detail.specs.category')}</Text>
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
            {prepareError ||
              (toggleLike.error
                ? isServerApiError(toggleLike.error)
                  ? localizeServerError(toggleLike.error)
                  : t('detail.likeFailedGeneric')
                : t('detail.likeFailedGeneric'))}
          </Text>
        </View>
      )}

      {isAuthenticated ? (
        <View style={styles.actionContainer}>
          {insufficientError ? (
            <Card style={styles.insufficientPanel}>
              <Text style={styles.insufficientTitle}>{t('detail.insufficientCoins.title')}</Text>
              <Text style={styles.insufficientBody}>
                {t('detail.insufficientCoins.body', {
                  price: formatNumber(insufficientError.price, locale),
                  balance: formatNumber(insufficientError.balance, locale),
                  shortfall: formatNumber(insufficientError.price - insufficientError.balance, locale),
                })}
              </Text>
              <Button
                title={t('detail.insufficientCoins.getCoins')}
                onPress={() => router.push({
                  pathname: '/(tabs)/(profile)/commerce',
                  params: {
                    category: 'stitch_coin',
                    source: 'stitch_coin_shortfall',
                  },
                })}
                variant="honey"
                style={styles.actionButton}
              />
              <Button
                title={t('detail.insufficientCoins.findPatterns')}
                onPress={() => router.navigate('/(tabs)/(catalog)')}
                variant="primary"
                style={styles.actionButton}
              />
              <Button
                title={t('detail.insufficientCoins.back')}
                onPress={() => setInsufficientError(null)}
                variant="secondary"
                style={[styles.actionButton, { marginTop: Theme.spacing.sm }]}
              />
            </Card>
          ) : owned ? (
            <Button
              title={preparing ? t('detail.actions.preparing') : t('detail.actions.startStitching')}
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
                  <Text style={styles.priceLabel}>{t('detail.price.label')}</Text>
                  <Text style={styles.priceText}>{formatNumber(price, locale)} 🪙</Text>
                </View>
                <View style={styles.balanceContainer}>
                  <Text style={styles.balanceLabel}>{t('detail.balance.label')}</Text>
                  <Text style={styles.balanceText}>
                    {balanceLoading ? t('detail.balance.loading') : `${formatNumber(balance ?? 0, locale)} 🪙`}
                  </Text>
                </View>
              </View>
              <Button
                title={t('detail.unlockButton', { price: formatNumber(price, locale) })}
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
          <Text style={styles.playSoonTitle}>{t('detail.connectToPlay.title')}</Text>
          <Text style={styles.playSoonBody}>
            {t('detail.connectToPlay.body')}
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
