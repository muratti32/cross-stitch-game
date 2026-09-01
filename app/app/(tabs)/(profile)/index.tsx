import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { useAiCreditBalance } from '@/api/commerce';
import { absolutePreviewUrl, absoluteThumbnailUrls } from '@/api/catalog';
import { useCreatorProfile } from '@/api/creatorProfile';
import { isServerApiError, localizeServerError } from '@/api/localizeServerError';
import {
  DAILY_TASK_COIN,
  useDailyTaskBoard,
  type DailyTaskKey,
  type DailyTaskStatus,
} from '@/api/dailyTasks';
import {
  useClaimAdReward,
  useCoinBalance,
  useOpenAdAttempt,
  useRewardDay,
} from '@/api/economy';
import { useMembership, usePremiumDailyClaim } from '@/api/membership';
import { useLikedPatterns } from '@/api/social';
import { Button, Card, EmptyState, PatternImage, Screen } from '@/components';
import { listPersonalPatterns, type PersonalPattern } from '@/conversion';
import { useRewardedAd } from '@/hooks/useRewardedAd';
import { useIdentityStore } from '@/identity/guestIdentity';
import { shortenGuestId } from '@/identity/identityLogic';
import { formatDate, formatNumber } from '@/i18n';
import { getPendingPersonalPatterns, type PendingPersonalPattern } from '@/local-db';
import {
  preparePendingPersonalSession,
  preparePersonalSession,
  waitUntilSessionReady,
} from '@/session-preparation';
import { Theme } from '@/theme/theme';

const TASK_ICONS: Record<DailyTaskKey, keyof typeof Ionicons.glyphMap> = {
  cells_100: 'grid-outline',
  three_colors_10: 'color-palette-outline',
  color_completion: 'checkmark-done-outline',
};

type TFn = (key: string, options?: Record<string, unknown>) => string;

function formatTimeRemaining(resetsAt: string | null | undefined, t: TFn): string {
  if (!resetsAt) return '';
  const diffMs = new Date(resetsAt).getTime() - Date.now();
  if (diffMs <= 0) return t('home.dailySection.resetting');
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return t('home.dailySection.resetsInMinutes', { minutes });
  return t('home.dailySection.resetsInHoursMinutes', { hours, minutes });
}

export default function ProfileScreen() {
  const { t, i18n: i18nInstance } = useTranslation('profile');
  const locale = i18nInstance.language;
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'my-patterns' | 'liked'>('my-patterns');
  const {
    guestId,
    guestCreatedAt,
    accountId,
    isAccount,
    isAuthenticated,
    isPending,
    isOfflinePending,
    bootstrap,
  } = useIdentityStore();

  const isConnected = isAuthenticated && !isPending && !isOfflinePending;

  // Currencies & Memberships
  const { data: coinBalance } = useCoinBalance();
  const { data: aiCreditBalance } = useAiCreditBalance(isAccount && isAuthenticated && !isPending);
  const membershipQuery = useMembership(isConnected);
  const membership = membershipQuery.data ?? null;
  const activeMembership = membership?.active === true;
  const dailyClaim = membership?.dailyClaim ?? null;
  const premiumClaimMutation = usePremiumDailyClaim();

  // Creator & Social Queries
  const creatorProfileQuery = useCreatorProfile(accountId, isAccount && isAuthenticated && !isPending);
  const likedPatternsQuery = useLikedPatterns();
  const creatorProfile = creatorProfileQuery.data ?? null;

  // Daily Tasks & Rewarded Ads
  const dailyTasksQuery = useDailyTaskBoard(isConnected);
  const rewardDayQuery = useRewardDay();
  const { mutateAsync: openAdAttempt } = useOpenAdAttempt();
  const { mutateAsync: claimAdReward } = useClaimAdReward();

  // Rewarded Ad state
  const [adAttempt, setAdAttempt] = useState<{ nonce: string; expiresAt: string } | null>(null);
  const [adAttemptPending, setAdAttemptPending] = useState(false);
  const [adEarned, setAdEarned] = useState(false);
  const [adLocalError, setAdLocalError] = useState<string | null>(null);

  const attemptRef = useRef(adAttempt);
  attemptRef.current = adAttempt;
  const activeNonceRef = useRef<string | null>(null);
  const claimingNonceRef = useRef<Set<string>>(new Set());

  const handleClaimAd = useCallback(
    async (nonce: string) => {
      if (claimingNonceRef.current.has(nonce)) return;
      claimingNonceRef.current.add(nonce);
      try {
        await claimAdReward(nonce);
        activeNonceRef.current = null;
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['economy', 'reward-day'] }),
          queryClient.invalidateQueries({ queryKey: ['economy', 'balance'] }),
          queryClient.invalidateQueries({ queryKey: ['commerce', 'membership'] }),
        ]);
      } catch (err: unknown) {
        claimingNonceRef.current.delete(nonce);
        // #159/#166: EconomyApiError's server-supplied `message` never
        // reaches the player; its `reason` maps to localized text instead.
        const msg = isServerApiError(err) ? localizeServerError(err) : t('home.dailyPool.claimFailedGeneric');
        setAdLocalError(t('home.dailyPool.claimFailed', { message: msg }));
      }
    },
    [claimAdReward, queryClient, t],
  );

  const { status: adStatus, show: showRewardedAd, error: adPluginError } = useRewardedAd({
    serverSideVerification: adAttempt?.nonce ? { customData: adAttempt.nonce } : undefined,
    onEarnedReward: async () => {
      setAdEarned(true);
      const nonceToClaim = activeNonceRef.current || attemptRef.current?.nonce;
      if (nonceToClaim) {
        await handleClaimAd(nonceToClaim);
      }
    },
  });

  const prevAdStatusRef = useRef(adStatus);
  useEffect(() => {
    if (adAttemptPending && adStatus === 'loaded') {
      showRewardedAd();
    }
  }, [adStatus, adAttemptPending, showRewardedAd]);

  useEffect(() => {
    const prevStatus = prevAdStatusRef.current;
    prevAdStatusRef.current = adStatus;

    if (adAttemptPending && prevStatus === 'showing' && adStatus !== 'showing') {
      const pendingNonce = activeNonceRef.current;
      if (pendingNonce && !claimingNonceRef.current.has(pendingNonce)) {
        handleClaimAd(pendingNonce).finally(() => {
          void queryClient.invalidateQueries({ queryKey: ['economy', 'reward-day'] });
          void queryClient.invalidateQueries({ queryKey: ['economy', 'balance'] });
          setAdAttempt(null);
          setAdAttemptPending(false);
        });
      } else {
        void queryClient.invalidateQueries({ queryKey: ['economy', 'reward-day'] });
        void queryClient.invalidateQueries({ queryKey: ['economy', 'balance'] });
        setAdAttempt(null);
        setAdAttemptPending(false);
      }
    }
  }, [adStatus, adAttemptPending, queryClient, handleClaimAd]);

  useEffect(() => {
    if (adAttemptPending && adStatus === 'error') {
      setAdLocalError(adPluginError?.message || t('home.dailyPool.adLoadFailedDefault'));
      activeNonceRef.current = null;
      setAdAttempt(null);
      setAdAttemptPending(false);
    }
  }, [adStatus, adAttemptPending, adPluginError, t]);

  const handleWatchAd = async () => {
    try {
      setAdLocalError(null);
      setAdAttemptPending(true);
      setAdEarned(false);
      const attemptData = await openAdAttempt();
      activeNonceRef.current = attemptData.nonce;
      setAdAttempt(attemptData);
    } catch (err) {
      activeNonceRef.current = null;
      setAdAttemptPending(false);
      setAdLocalError(isServerApiError(err) ? localizeServerError(err) : t('home.dailyPool.adAttemptFailedDefault'));
    }
  };

  // Premium Claim Reset Tracking
  const claimResult = premiumClaimMutation.data;
  const resultRewardDayRef = useRef<string | null>(null);
  useEffect(() => {
    if (claimResult === undefined) return;
    if (resultRewardDayRef.current === null) {
      resultRewardDayRef.current = dailyClaim?.resetsAt ?? null;
      return;
    }
    if (dailyClaim?.resetsAt && dailyClaim.resetsAt !== resultRewardDayRef.current) {
      resultRewardDayRef.current = null;
      premiumClaimMutation.reset();
    }
  }, [claimResult, dailyClaim?.resetsAt, premiumClaimMutation]);

  // Personal & Pending Patterns
  const [personalPatterns, setPersonalPatterns] = useState<PersonalPattern[]>([]);
  const [patternsLoading, setPatternsLoading] = useState(false);
  const [openingPatternId, setOpeningPatternId] = useState<string | null>(null);
  const [patternsError, setPatternsError] = useState<string | null>(null);
  const [pendingPatterns, setPendingPatterns] = useState<PendingPersonalPattern[]>([]);
  const [openingPendingId, setOpeningPendingId] = useState<string | null>(null);
  const [isRetryingProfile, setIsRetryingProfile] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!isAccount || activeTab !== 'my-patterns') {
        setPersonalPatterns([]);
        setPendingPatterns([]);
        return undefined;
      }
      let active = true;
      setPatternsLoading(true);
      setPatternsError(null);
      Promise.all([listPersonalPatterns(), getPendingPersonalPatterns()])
        .then(([patterns, pending]) => {
          if (!active) return;
          setPersonalPatterns(patterns);
          const syncedIds = new Set(patterns.map((p) => p.id));
          setPendingPatterns(pending.filter((p) => !syncedIds.has(p.patternId)));
        })
        .catch((error: unknown) => {
          if (active) {
            setPatternsError(isServerApiError(error) ? localizeServerError(error) : t('home.myPatterns.actionFailedGeneric'));
          }
        })
        .finally(() => {
          if (active) setPatternsLoading(false);
        });
      return () => {
        active = false;
      };
    }, [activeTab, isAccount]),
  );

  useFocusEffect(
    useCallback(() => {
      if (isAccount && activeTab === 'liked') {
        void likedPatternsQuery.refetch();
      }
    }, [activeTab, isAccount, likedPatternsQuery.refetch]),
  );

  const openPersonalPattern = async (pattern: PersonalPattern) => {
    setOpeningPatternId(pattern.id);
    setPatternsError(null);
    try {
      const session = await preparePersonalSession(pattern.id, {
        height: pattern.height,
        previewUrl: pattern.previewUrl,
        thumbnailUrl: pattern.thumbnailUrls?.browsing ?? null,
        title: pattern.title,
        width: pattern.width,
      });
      const ready = await waitUntilSessionReady(session.id);
      router.push({
        pathname: '/(tabs)/(play)/[sessionId]',
        params: { sessionId: ready.id, returnTo: '/(tabs)/(profile)' },
      });
    } catch (error: unknown) {
      setPatternsError(t('home.myPatterns.actionFailedGeneric'));
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
      router.push({
        pathname: '/(tabs)/(play)/[sessionId]',
        params: { sessionId: ready.id, returnTo: '/(tabs)/(profile)' },
      });
    } catch (error: unknown) {
      setPatternsError(t('home.myPatterns.actionFailedGeneric'));
    } finally {
      setOpeningPendingId(null);
    }
  };

  const handleEditProfile = () => {
    router.push('/(tabs)/(profile)/public-profile');
  };

  const handleRetryProfile = async () => {
    setIsRetryingProfile(true);
    try {
      await bootstrap();
    } catch {
      // refetch will handle error
    }
    try {
      await creatorProfileQuery.refetch();
    } finally {
      setIsRetryingProfile(false);
    }
  };

  const openCommerce = (category?: 'stitch_coin' | 'ai_credit' | 'premium') => {
    if (category) {
      router.push({
        pathname: '/(tabs)/(profile)/commerce',
        params: { category, source: 'profile' },
      });
    } else {
      router.push({
        pathname: '/(tabs)/(profile)/commerce',
        params: { source: 'profile' },
      });
    }
  };

  // Derived daily pool info
  const rewardDay = rewardDayQuery.data;
  const isPremiumClaimed = claimResult?.claimed === true || dailyClaim?.claimed === true;
  const premiumCoinsAvailable = claimResult?.claimed === true ? 0 : dailyClaim?.coinsAvailable ?? 0;
  const isPremiumPoolExhausted = activeMembership && !isPremiumClaimed && dailyClaim?.coinsAvailable === 0;

  const resetsAtTime = dailyTasksQuery.data?.resetsAt || rewardDay?.resetsAt || dailyClaim?.resetsAt;
  const formattedReset = formatTimeRemaining(resetsAtTime, t);

  const likedCount = likedPatternsQuery.data?.pages.flatMap((page) => page.items).length ?? 0;
  const creationsCount = personalPatterns.length + pendingPatterns.length;

  return (
    <Screen scrollable contentContainerStyle={styles.container}>
      {/* 1. Profile / Account Identity Header */}
      {isPending && !guestId ? (
        <View style={styles.profileCard}>
          <ActivityIndicator size="large" color={Theme.colors.accentRose} />
          <Text style={[styles.displayName, { marginTop: Theme.spacing.md }]}>{t('home.identity.establishing')}</Text>
        </View>
      ) : isOfflinePending && !guestId ? (
        <View style={styles.profileCard}>
          <View style={styles.avatarContainer}>
            <Ionicons name="cloud-offline-outline" size={44} color={Theme.colors.error} />
          </View>
          <Text style={styles.displayName}>{t('home.identity.pendingTitle')}</Text>
          <Text style={[styles.username, { color: Theme.colors.error }]}>{t('home.identity.offline')}</Text>
          <Pressable onPress={() => bootstrap()} style={styles.retryButton}>
            <Text style={styles.retryButtonText}>{t('home.identity.retryConnection')}</Text>
          </Pressable>
        </View>
      ) : isAccount && creatorProfileQuery.isLoading ? (
        <View style={styles.profileCard}>
          <ActivityIndicator size="large" color={Theme.colors.accentRose} />
          <Text style={styles.profileStatusText}>{t('home.identity.loadingPublicProfile')}</Text>
        </View>
      ) : isAccount && creatorProfileQuery.isError ? (
        <View style={styles.profileCard}>
          <View style={styles.avatarContainer}>
            <Ionicons name="cloud-offline-outline" size={44} color={Theme.colors.error} />
          </View>
          <Text style={styles.displayName}>{t('home.identity.unavailableTitle')}</Text>
          <Text style={styles.profileHelpText}>
            {creatorProfileQuery.error && isServerApiError(creatorProfileQuery.error)
              ? localizeServerError(creatorProfileQuery.error)
              : t('home.identity.checkConnection')}
          </Text>
          <Pressable
            disabled={creatorProfileQuery.isRefetching || isRetryingProfile}
            onPress={handleRetryProfile}
            style={[
              styles.retryButton,
              (creatorProfileQuery.isRefetching || isRetryingProfile) && { opacity: 0.7 },
            ]}
          >
            {creatorProfileQuery.isRefetching || isRetryingProfile ? (
              <ActivityIndicator size="small" color={Theme.colors.error} />
            ) : (
              <Text style={styles.retryButtonText}>{t('common.tryAgain')}</Text>
            )}
          </Pressable>
        </View>
      ) : isAccount && creatorProfile === null ? (
        <View style={styles.profileCard}>
          <View style={styles.avatarContainer}>
            <Ionicons name="person-add-outline" size={40} color={Theme.colors.accentRose} />
          </View>
          <Text style={styles.displayName}>{t('home.identity.createTitle')}</Text>
          <Text style={styles.profileHelpText}>{t('home.identity.createBody')}</Text>
          <Pressable onPress={handleEditProfile} style={styles.editButton}>
            <Text style={styles.editButtonText}>{t('home.identity.createAction')}</Text>
          </Pressable>
        </View>
      ) : isAccount && creatorProfile !== null ? (
        <View style={styles.profileCard}>
          <View style={styles.avatarContainer}>
            {creatorProfile.avatarUrl === null ? (
              <Ionicons name="person" size={44} color={Theme.colors.accentRose} />
            ) : (
              <Image source={{ uri: creatorProfile.avatarUrl }} style={styles.avatarImage} />
            )}
          </View>

          <Text style={styles.displayName}>{creatorProfile.displayName}</Text>
          <Text style={styles.username}>@{creatorProfile.username}</Text>
          <Text style={styles.sinceText}>
            {t('home.identity.creatorSince', { date: formatDate(new Date(creatorProfile.createdAt), locale) })}
          </Text>

          <Pressable onPress={handleEditProfile} style={styles.editButton}>
            <Text style={styles.editButtonText}>{t('home.identity.editAction')}</Text>
          </Pressable>

          {isOfflinePending && (
            <View style={styles.offlineBadge}>
              <Ionicons name="alert-circle-outline" size={14} color={Theme.colors.error} />
              <Text style={styles.offlineBadgeText}>{t('home.identity.offlinePendingSync')}</Text>
            </View>
          )}
        </View>
      ) : (
        <View style={styles.profileCard}>
          <View style={styles.avatarContainer}>
            <Ionicons name="person" size={44} color={Theme.colors.accentRose} />
          </View>
          <Text style={styles.displayName}>{t('home.identity.guestPlayer')}</Text>
          <Text style={styles.username}>@{shortenGuestId(guestId || '')}</Text>
          {guestCreatedAt && (
            <Text style={styles.sinceText}>
              {t('home.identity.playingSince', { date: formatDate(new Date(guestCreatedAt), locale) })}
            </Text>
          )}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('home.identity.signInOrSignUp')}
            onPress={() =>
              router.push({
                pathname: '/(tabs)/(settings)/sign-in',
                params: { returnTo: '/(tabs)/(profile)' },
              })
            }
            style={({ pressed }) => [styles.guestSignInButton, pressed && styles.pressed]}
          >
            <Ionicons name="log-in-outline" size={14} color={Theme.colors.accentRose} />
            <Text style={styles.guestSignInButtonText}>{t('home.identity.signInOrSignUp')}</Text>
          </Pressable>

          {isOfflinePending && (
            <View style={styles.offlineBadge}>
              <Ionicons name="alert-circle-outline" size={14} color={Theme.colors.error} />
              <Text style={styles.offlineBadgeText}>{t('home.identity.offlinePendingSync')}</Text>
            </View>
          )}
        </View>
      )}

      {/* 2. Studio Wallet & Commerce Hub */}
      <View style={styles.walletCard}>
        <View style={styles.walletHeader}>
          <View style={styles.walletHeaderLeft}>
            <Ionicons name="wallet-outline" size={18} color={Theme.colors.textPrimary} />
            <Text style={styles.walletTitle}>{t('home.walletCard.title')}</Text>
          </View>
          <Pressable
            accessibilityLabel={t('home.walletCard.openCommerceStoreAccessibilityLabel')}
            accessibilityRole="button"
            onPress={() => openCommerce()}
            style={({ pressed }) => [styles.storeLink, pressed && styles.pressed]}
          >
            <Ionicons name="storefront-outline" size={15} color={Theme.colors.accentRose} />
            <Text style={styles.storeLinkText}>{t('home.walletCard.commerceStoreLink')}</Text>
            <Ionicons name="chevron-forward" size={14} color={Theme.colors.accentRose} />
          </Pressable>
        </View>

        {/* Currency Dual Balances */}
        <View style={styles.balancesRow}>
          {/* Stitch Coins Tile */}
          <Pressable
            accessibilityLabel={t('home.walletCard.stitchCoinsAccessibilityLabel', { balance: formatNumber(coinBalance ?? 0, locale) })}
            accessibilityRole="button"
            onPress={() => openCommerce('stitch_coin')}
            style={({ pressed }) => [styles.balanceTile, pressed && styles.pressed]}
          >
            <View style={styles.balanceTileHeader}>
              <View style={[styles.balanceIconWrap, { backgroundColor: Theme.colors.accentHoneySoft }]}>
                <Ionicons name="disc" size={18} color={Theme.colors.accentHoney} />
              </View>
              <View style={[styles.addPill, { borderColor: Theme.colors.accentHoney }]}>
                <Ionicons name="add" size={13} color={Theme.colors.accentHoney} />
                <Text style={[styles.addPillText, { color: Theme.colors.accentHoney }]}>{t('home.walletCard.packs')}</Text>
              </View>
            </View>
            <Text style={styles.balanceValue}>{formatNumber(coinBalance ?? 0, locale)}</Text>
            <Text style={styles.balanceLabel}>{t('home.walletCard.stitchCoinsLabel')}</Text>
            <Text style={styles.balanceSub}>{t('home.walletCard.stitchCoinsSub')}</Text>
          </Pressable>

          {/* AI Credits Tile */}
          <Pressable
            accessibilityLabel={
              isAccount
                ? t('home.walletCard.aiCreditsAccessibilityLabel', { balance: formatNumber(aiCreditBalance ?? 0, locale) })
                : t('home.walletCard.aiCreditsSignInAccessibilityLabel')
            }
            accessibilityRole="button"
            onPress={() => openCommerce('ai_credit')}
            style={({ pressed }) => [styles.balanceTile, pressed && styles.pressed]}
          >
            <View style={styles.balanceTileHeader}>
              <View style={[styles.balanceIconWrap, { backgroundColor: '#FDEEED' }]}>
                <Ionicons name="sparkles" size={18} color={Theme.colors.accentRose} />
              </View>
              <View style={[styles.addPill, { borderColor: Theme.colors.accentRose }]}>
                <Ionicons name="add" size={13} color={Theme.colors.accentRose} />
                <Text style={[styles.addPillText, { color: Theme.colors.accentRose }]}>{t('home.walletCard.packs')}</Text>
              </View>
            </View>
            <Text style={styles.balanceValue}>
              {isAccount ? formatNumber(aiCreditBalance ?? 0, locale) : '—'}
            </Text>
            <Text style={styles.balanceLabel}>{t('home.walletCard.aiCreditsLabel')}</Text>
            <Text style={styles.balanceSub}>
              {isAccount ? t('home.walletCard.aiCreditsSubOwned') : t('home.walletCard.aiCreditsSubGuest')}
            </Text>
          </Pressable>
        </View>

        {/* Premium Membership Banner Strip */}
        <Pressable
          accessibilityLabel={
            activeMembership
              ? t('home.walletCard.membershipActiveAccessibilityLabel', { plan: membership?.plan ?? 'membership' })
              : t('home.walletCard.membershipInactiveAccessibilityLabel')
          }
          accessibilityRole="button"
          onPress={() => openCommerce(activeMembership ? 'premium' : undefined)}
          style={({ pressed }) => [
            styles.membershipStrip,
            activeMembership && styles.membershipStripActive,
            pressed && styles.pressed,
          ]}
        >
          <View
            style={[
              styles.membershipIconWrap,
              activeMembership && { backgroundColor: Theme.colors.accentHoneySoft },
            ]}
          >
            <Ionicons
              name={activeMembership ? 'diamond' : 'diamond-outline'}
              size={20}
              color={Theme.colors.accentHoney}
            />
          </View>

          <View style={styles.membershipCopy}>
            <View style={styles.membershipTitleRow}>
              <Text style={styles.membershipTitle}>
                {activeMembership
                  ? t('home.walletCard.membershipActiveTitle', {
                      plan:
                        membership?.plan === 'annual'
                          ? t('home.walletCard.planAnnual')
                          : membership?.plan === 'monthly'
                          ? t('home.walletCard.planMonthly')
                          : membership?.plan === 'weekly'
                          ? t('home.walletCard.planWeekly')
                          : t('home.walletCard.planActive'),
                    })
                  : t('home.walletCard.membershipInactiveTitle')}
              </Text>
              {activeMembership && membership?.lifecycle === 'trial' && (
                <View style={styles.trialBadge}>
                  <Text style={styles.trialBadgeText}>{t('home.walletCard.trialBadge')}</Text>
                </View>
              )}
            </View>
            <Text style={styles.membershipSub}>
              {activeMembership
                ? t('home.walletCard.membershipSubActive')
                : t('home.walletCard.membershipSubInactive')}
            </Text>
          </View>

          <View style={styles.membershipAction}>
            <Text
              style={[
                styles.membershipActionText,
                activeMembership && { color: Theme.colors.accentHoney },
              ]}
            >
              {activeMembership ? t('home.walletCard.manage') : t('home.walletCard.explore')}
            </Text>
            <Ionicons
              name="chevron-forward"
              size={14}
              color={activeMembership ? Theme.colors.accentHoney : Theme.colors.accentRose}
            />
          </View>
        </Pressable>
      </View>

      {/* 3. Account & Creator Quick Hub (Registered Accounts) */}
      {isAccount && (
        <View style={styles.quickNavSection}>
          <Text style={styles.sectionEyebrow}>{t('home.quickNav.sectionEyebrow')}</Text>
          <View style={styles.quickNavGrid}>
            {creatorProfile !== null && (
              <Pressable
                accessibilityLabel={t('home.quickNav.submissionsAccessibilityLabel')}
                accessibilityRole="button"
                onPress={() => router.push('/(tabs)/(profile)/submissions')}
                style={({ pressed }) => [styles.quickNavTile, pressed && styles.pressed]}
              >
                <View style={[styles.quickNavIcon, { backgroundColor: '#EBF4F5' }]}>
                  <Ionicons name="file-tray-full-outline" size={20} color={Theme.colors.accentTeal} />
                </View>
                <View style={styles.quickNavText}>
                  <Text style={styles.quickNavTitle}>{t('home.quickNav.submissionsTitle')}</Text>
                  <Text style={styles.quickNavSub}>{t('home.quickNav.submissionsSub')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={Theme.colors.textSecondary} />
              </Pressable>
            )}

            {creatorProfile !== null && (
              <Pressable
                accessibilityLabel={t('home.quickNav.publishedAccessibilityLabel')}
                accessibilityRole="button"
                onPress={() => router.push('/(tabs)/(profile)/published-patterns')}
                style={({ pressed }) => [styles.quickNavTile, pressed && styles.pressed]}
              >
                <View style={[styles.quickNavIcon, { backgroundColor: '#EBF4F5' }]}>
                  <Ionicons name="albums-outline" size={20} color={Theme.colors.accentTeal} />
                </View>
                <View style={styles.quickNavText}>
                  <Text style={styles.quickNavTitle}>{t('home.quickNav.publishedTitle')}</Text>
                  <Text style={styles.quickNavSub}>{t('home.quickNav.publishedSub')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={Theme.colors.textSecondary} />
              </Pressable>
            )}

            <Pressable
              accessibilityLabel={t('home.quickNav.moderationAccessibilityLabel')}
              accessibilityRole="button"
              onPress={() => router.push('/(tabs)/(profile)/moderation-notices')}
              style={({ pressed }) => [styles.quickNavTile, pressed && styles.pressed]}
            >
              <View style={[styles.quickNavIcon, { backgroundColor: '#EBF4F5' }]}>
                <Ionicons name="shield-checkmark-outline" size={20} color={Theme.colors.accentTeal} />
              </View>
              <View style={styles.quickNavText}>
                <Text style={styles.quickNavTitle}>{t('home.quickNav.moderationTitle')}</Text>
                <Text style={styles.quickNavSub}>{t('home.quickNav.moderationSub')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={Theme.colors.textSecondary} />
            </Pressable>

            <Pressable
              accessibilityLabel={t('home.quickNav.likedAccessibilityLabel')}
              accessibilityRole="button"
              onPress={() => router.push('/(tabs)/(profile)/liked-patterns')}
              style={({ pressed }) => [styles.quickNavTile, pressed && styles.pressed]}
            >
              <View style={[styles.quickNavIcon, { backgroundColor: '#FDEEED' }]}>
                <Ionicons name="heart-outline" size={20} color={Theme.colors.accentRose} />
              </View>
              <View style={styles.quickNavText}>
                <Text style={styles.quickNavTitle}>{t('home.quickNav.likedTitle')}</Text>
                <Text style={styles.quickNavSub}>
                  {likedCount > 0
                    ? t('home.quickNav.likedSavedCount', { count: likedCount })
                    : t('home.quickNav.likedSavedDefault')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={Theme.colors.textSecondary} />
            </Pressable>
          </View>
        </View>
      )}

      {/* 4. Daily Stitching & Rewards Hub */}
      <View style={styles.dailySection}>
        <View style={styles.dailyHeader}>
          <View style={styles.dailyHeaderTitleRow}>
            <Ionicons name="calendar-outline" size={18} color={Theme.colors.accentHoney} />
            <Text style={styles.dailyHeaderTitle}>{t('home.dailySection.title')}</Text>
          </View>
          {formattedReset ? (
            <View style={styles.resetBadge}>
              <Ionicons name="time-outline" size={12} color={Theme.colors.textSecondary} />
              <Text style={styles.resetBadgeText}>{formattedReset}</Text>
            </View>
          ) : null}
        </View>

        {/* Part A: Daily Tasks */}
        <View style={styles.dailyTasksContainer}>
          <Text style={styles.dailyGroupLabel}>{t('home.dailySection.tasksGroupLabel')}</Text>

          {!isConnected ? (
            <Text style={styles.mutedText}>{t('home.dailySection.connectToTrack')}</Text>
          ) : dailyTasksQuery.isLoading ? (
            <View style={styles.dailyLoadingRow}>
              <ActivityIndicator size="small" color={Theme.colors.accentRose} />
              <Text style={styles.mutedText}>{t('home.dailySection.loadingTasks')}</Text>
            </View>
          ) : dailyTasksQuery.isError || !dailyTasksQuery.data ? (
            <View style={styles.dailyErrorRow}>
              <Text style={styles.errorText}>{t('home.dailySection.loadFailed')}</Text>
              <Pressable onPress={() => void dailyTasksQuery.refetch()} hitSlop={8}>
                <Text style={styles.retryLinkText}>{t('home.dailySection.retry')}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.tasksList}>
              {dailyTasksQuery.data.tasks.map((task: DailyTaskStatus) => {
                const icon = TASK_ICONS[task.key];
                const pct = task.target > 0 ? Math.min(1, task.progress / task.target) : 0;
                return (
                  <View key={task.key} style={styles.taskItem}>
                    <View
                      style={[
                        styles.taskIconCircle,
                        task.granted && { backgroundColor: '#EEF7EF' },
                      ]}
                    >
                      <Ionicons
                        name={task.granted ? 'checkmark-circle' : icon}
                        size={17}
                        color={task.granted ? Theme.colors.success : Theme.colors.accentTeal}
                      />
                    </View>
                    <View style={styles.taskContent}>
                      <View style={styles.taskRowTop}>
                        <Text style={styles.taskTitle}>{t(`home.dailyTasks.${task.key}.title`)}</Text>
                        <Text
                          style={[
                            styles.taskCoinText,
                            task.granted && { color: Theme.colors.success },
                          ]}
                        >
                          {t('home.dailySection.taskCoinReward', { amount: formatNumber(DAILY_TASK_COIN, locale) })}
                        </Text>
                      </View>
                      <Text style={styles.taskDesc}>{t(`home.dailyTasks.${task.key}.body`)}</Text>
                      <View style={styles.taskProgressRow}>
                        <View style={styles.taskProgressBar}>
                          <View
                            style={[
                              styles.taskProgressFill,
                              { width: `${pct * 100}%` },
                              task.granted && { backgroundColor: Theme.colors.success },
                            ]}
                          />
                        </View>
                        <Text style={styles.taskProgressNumbers}>
                          {t('home.dailySection.taskProgress', {
                            progress: formatNumber(task.progress, locale),
                            target: formatNumber(task.target, locale),
                          })}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* Part B: Daily 30-Coin Reward Pool (Ads vs Instant Premium Claim) */}
        <View style={styles.dailyRewardPoolContainer}>
          <View style={styles.poolHeader}>
            <View style={styles.poolTitleWrap}>
              <Ionicons name="sparkles" size={15} color={Theme.colors.accentHoney} />
              <Text style={styles.poolTitle}>{t('home.dailyPool.title')}</Text>
            </View>
            {activeMembership ? (
              <View style={styles.poolMembershipTag}>
                <Text style={styles.poolMembershipTagText}>{t('home.dailyPool.premiumInstantClaim')}</Text>
              </View>
            ) : (
              <View style={styles.poolAdsTag}>
                <Text style={styles.poolAdsTagText}>{t('home.dailyPool.rewardedAds')}</Text>
              </View>
            )}
          </View>

          {/* If Active Premium: Instant 1-tap claim */}
          {activeMembership ? (
            <View style={styles.premiumClaimBlock}>
              {claimResult !== undefined ? (
                <View style={styles.claimSuccessBox}>
                  <Ionicons name="checkmark-circle" size={18} color={Theme.colors.success} />
                  <Text style={styles.claimSuccessText}>
                    {claimResult.amount > 0
                      ? t('home.dailyPool.claimedAmount', { amount: formatNumber(claimResult.amount, locale) })
                      : t('home.dailyPool.poolAlreadyClosed')}
                  </Text>
                </View>
              ) : isPremiumClaimed ? (
                <View style={styles.claimStatusMutedBox}>
                  <Ionicons name="checkmark-done" size={16} color={Theme.colors.success} />
                  <Text style={styles.claimStatusMutedText}>
                    {t('home.dailyPool.claimedForToday')}
                  </Text>
                </View>
              ) : isPremiumPoolExhausted ? (
                <View style={styles.claimStatusMutedBox}>
                  <Ionicons name="information-circle-outline" size={16} color={Theme.colors.textSecondary} />
                  <Text style={styles.claimStatusMutedText}>
                    {t('home.dailyPool.poolExhausted')}
                  </Text>
                </View>
              ) : (
                <Button
                  title={
                    premiumClaimMutation.error
                      ? t('home.dailyPool.claimButtonRetry')
                      : t('home.dailyPool.claimButtonInstant', { count: formatNumber(premiumCoinsAvailable, locale) })
                  }
                  onPress={() => premiumClaimMutation.mutate()}
                  disabled={premiumCoinsAvailable === 0}
                  loading={premiumClaimMutation.isPending}
                  variant="honey"
                  style={styles.claimButton}
                />
              )}

              {premiumClaimMutation.error && (
                <Text style={styles.errorText}>
                  {isServerApiError(premiumClaimMutation.error)
                    ? localizeServerError(premiumClaimMutation.error)
                    : t('home.dailyPool.claimFailedGeneric')}
                </Text>
              )}
            </View>
          ) : (
            /* Free / Guest: Rewarded Ad */
            <View style={styles.adRewardBlock}>
              {rewardDay?.premiumClaimed ? (
                <Text style={styles.poolInfoMuted}>
                  {t('home.dailyPool.poolClaimedResetsTomorrow')}
                </Text>
              ) : (rewardDay?.adsRemaining ?? 0) <= 0 || (rewardDay?.coinsRemaining ?? 0) < 10 ? (
                <View style={styles.claimStatusMutedBox}>
                  <Ionicons name="checkmark-done" size={16} color={Theme.colors.success} />
                  <Text style={styles.claimStatusMutedText}>
                    {t('home.dailyPool.allAdRewardsCompleted')}
                  </Text>
                </View>
              ) : (
                <>
                  <Button
                    title={t('home.dailyPool.watchAdButton', { count: formatNumber(rewardDay?.adsRemaining ?? 3, locale) })}
                    onPress={handleWatchAd}
                    disabled={adAttemptPending || adStatus === 'unavailable'}
                    loading={adAttemptPending}
                    variant="honey"
                    style={styles.claimButton}
                  />
                  <Text style={styles.adPerkNote}>
                    {t('home.dailyPool.adPerkNote')}
                  </Text>
                </>
              )}

              {adEarned && (
                <Text style={styles.adSuccessText}>{t('home.dailyPool.adRewardEarned')}</Text>
              )}
              {adLocalError && (
                <Text style={styles.errorText}>{adLocalError}</Text>
              )}
            </View>
          )}
        </View>
      </View>

      {/* 5. Creations & Liked Patterns Tabs */}
      <View style={styles.tabBar}>
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'my-patterns' }}
          onPress={() => setActiveTab('my-patterns')}
          style={[styles.tabItem, activeTab === 'my-patterns' && styles.activeTabItem]}
        >
          <Text style={[styles.tabLabel, activeTab === 'my-patterns' && styles.activeTabLabel]}>
            {t('home.tabs.myCreations', { count: creationsCount > 0 ? `(${formatNumber(creationsCount, locale)})` : '' })}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: activeTab === 'liked' }}
          onPress={() => setActiveTab('liked')}
          style={[styles.tabItem, activeTab === 'liked' && styles.activeTabItem]}
        >
          <Text style={[styles.tabLabel, activeTab === 'liked' && styles.activeTabLabel]}>
            {t('home.tabs.likedPatterns', { count: likedCount > 0 ? `(${formatNumber(likedCount, locale)})` : '' })}
          </Text>
        </Pressable>
      </View>

      {/* Tab Content / Lists */}
      <View style={styles.content}>
        {activeTab === 'my-patterns' && !isAccount ? (
          <EmptyState
            icon="person-circle-outline"
            title={t('home.myPatterns.signInTitle')}
            body={t('home.myPatterns.signInBody')}
            actionLabel={t('home.myPatterns.signIn')}
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
                  <Text style={styles.patternTitle} numberOfLines={1}>
                    {pending.title}
                  </Text>
                  <Text style={styles.patternMeta}>
                    {t('home.myPatterns.patternMeta', { count: pending.palette.length, height: pending.height, width: pending.width })}
                  </Text>
                  <View style={styles.patternPendingBadge}>
                    <Ionicons name="sync-outline" size={12} color={Theme.colors.error} />
                    <Text style={styles.patternPendingBadgeText}>{t('home.myPatterns.pendingSync')}</Text>
                  </View>
                </View>
                <Button
                  title={t('home.myPatterns.play')}
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
                <PatternImage
                  assets={{ thumbnailUrls: pattern.thumbnailUrls, previewUrl: pattern.previewUrl }}
                  variant="browsing"
                  style={styles.patternPreview}
                />
                <View style={styles.patternInfo}>
                  <Text style={styles.patternTitle} numberOfLines={1}>
                    {pattern.title}
                  </Text>
                  <Text style={styles.patternMeta}>
                    {t('home.myPatterns.patternMeta', { count: pattern.paletteSize, height: pattern.height, width: pattern.width })}
                  </Text>
                </View>
                <Button
                  title={t('home.myPatterns.play')}
                  variant="sage"
                  loading={openingPatternId === pattern.id}
                  disabled={openingPatternId !== null}
                  onPress={() => void openPersonalPattern(pattern)}
                  style={styles.playButton}
                />
                <Button
                  title={t('home.myPatterns.edit')}
                  variant="secondary"
                  onPress={() => router.push(`/(tabs)/(create)/pattern-editor?patternId=${pattern.id}`)}
                  style={styles.patternEditButton}
                />
                {creatorProfile !== null && (
                  <Pressable
                    accessibilityLabel={t('home.myPatterns.submitAccessibilityLabel', { title: pattern.title })}
                    accessibilityRole="button"
                    onPress={() => router.push(`/(tabs)/(profile)/submit-pattern?patternId=${pattern.id}`)}
                    style={({ pressed }) => [styles.patternSubmitButton, pressed && styles.pressed]}
                  >
                    <Ionicons name="cloud-upload-outline" size={18} color={Theme.colors.accentRose} />
                  </Pressable>
                )}
              </Card>
            ))}
            {patternsError && <Text style={styles.patternError}>{patternsError}</Text>}
          </View>
        ) : activeTab === 'liked' && likedPatternsQuery.isPending ? (
          <View style={styles.patternLoader}>
            <ActivityIndicator color={Theme.colors.accentRose} />
          </View>
        ) : activeTab === 'liked' && likedPatternsQuery.isError ? (
          <EmptyState
            icon="cloud-offline-outline"
            title={t('home.likedTab.unavailableTitle')}
            body={
              likedPatternsQuery.error && isServerApiError(likedPatternsQuery.error)
                ? localizeServerError(likedPatternsQuery.error)
                : t('home.likedTab.unavailableDefault')
            }
            actionLabel={t('common.tryAgain')}
            onAction={() => void likedPatternsQuery.refetch()}
            actionVariant="rose"
          />
        ) : activeTab === 'liked' && (likedPatternsQuery.data?.pages.flatMap((page) => page.items).length ?? 0) > 0 ? (
          <View style={styles.patternList}>
            {likedPatternsQuery.data?.pages
              .flatMap((page) => page.items)
              .map((pattern) => (
                <Pressable
                  key={pattern.id}
                  onPress={() =>
                    router.push({
                      pathname: '/(tabs)/(catalog)/[id]',
                      params: { id: pattern.id, returnTo: '/(tabs)/(profile)' },
                    })
                  }
                  style={({ pressed }) => [pressed && styles.pressed]}
                >
                  <Card style={styles.patternCard}>
                    <PatternImage
                      assets={{
                        thumbnailUrls: absoluteThumbnailUrls(pattern.thumbnailUrls),
                        previewUrl: absolutePreviewUrl(pattern.previewUrl),
                      }}
                      variant="browsing"
                      style={styles.patternPreview}
                    />
                    <View style={styles.patternInfo}>
                      <Text style={styles.patternTitle} numberOfLines={1}>
                        {pattern.title}
                      </Text>
                      <Text style={styles.patternMeta}>{t('home.likedTab.byCreator', { creatorName: pattern.creatorName })}</Text>
                      <Text style={styles.patternMeta}>
                        {t('home.likedTab.specs', { count: pattern.paletteSize, height: pattern.height, width: pattern.width })}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={Theme.colors.textSecondary} />
                  </Card>
                </Pressable>
              ))}
          </View>
        ) : activeTab === 'my-patterns' ? (
          <EmptyState
            icon="color-palette-outline"
            title={t('home.myPatterns.emptyTitle')}
            body={t('home.myPatterns.emptyBody')}
            actionLabel={t('home.myPatterns.emptyAction')}
            onAction={() => router.push('/(tabs)/(create)/photo-import')}
            actionVariant="rose"
          />
        ) : (
          <EmptyState
            icon="heart-outline"
            title={t('home.likedTab.emptyTitle')}
            body={t('home.likedTab.emptyBody')}
            actionLabel={t('home.likedTab.emptyAction')}
            onAction={() => router.push('/(tabs)/(catalog)')}
            actionVariant="sage"
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: Theme.spacing.lg,
    paddingHorizontal: Theme.spacing.lg,
    paddingBottom: 110,
  },

  // 1. Profile Header
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
    width: 82,
    height: 82,
    borderRadius: Theme.radii.full,
    backgroundColor: '#FCFAF7',
    borderWidth: 1.5,
    borderColor: Theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Theme.spacing.sm,
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
    marginTop: 2,
    marginBottom: Theme.spacing.sm,
  },
  sinceText: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    marginBottom: Theme.spacing.sm,
  },
  editButton: {
    paddingVertical: 6,
    paddingHorizontal: Theme.spacing.lg,
    borderRadius: Theme.radii.full,
    borderWidth: 1,
    borderColor: Theme.colors.accentTeal,
    marginTop: 2,
  },
  editButtonText: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.accentTeal,
  },
  guestSignInButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: Theme.spacing.lg,
    borderRadius: Theme.radii.full,
    borderWidth: 1,
    borderColor: Theme.colors.accentRose,
    marginTop: 2,
  },
  guestSignInButtonText: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.accentRose,
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
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FDF2F2',
    borderWidth: 1,
    borderColor: '#FBD5D5',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: Theme.radii.sm,
    gap: 4,
    marginTop: Theme.spacing.xs,
  },
  offlineBadgeText: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.medium,
    color: Theme.colors.error,
  },
  retryButton: {
    paddingVertical: 6,
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

  // 2. Studio Wallet Card
  walletCard: {
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.lg,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    padding: Theme.spacing.md,
    marginBottom: Theme.spacing.lg,
  },
  walletHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Theme.spacing.md,
    paddingHorizontal: 2,
  },
  walletHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  walletTitle: {
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
    letterSpacing: 0.5,
  },
  storeLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  storeLinkText: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.accentRose,
  },
  balancesRow: {
    flexDirection: 'row',
    gap: Theme.spacing.sm,
  },
  balanceTile: {
    flex: 1,
    backgroundColor: '#FAF7F2',
    borderRadius: Theme.radii.md,
    borderWidth: 1,
    borderColor: '#EFE6D8',
    padding: Theme.spacing.md,
  },
  balanceTileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  balanceIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: Theme.radii.full,
    paddingVertical: 2,
    paddingHorizontal: 6,
    gap: 1,
  },
  addPillText: {
    fontSize: 10,
    fontWeight: Theme.typography.weights.bold,
  },
  balanceValue: {
    fontSize: 21,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  balanceLabel: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textPrimary,
    marginTop: 2,
  },
  balanceSub: {
    fontSize: 10,
    color: Theme.colors.textSecondary,
    marginTop: 1,
  },

  // Premium Strip
  membershipStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9F5EE',
    borderRadius: Theme.radii.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    padding: Theme.spacing.md,
    marginTop: Theme.spacing.md,
    gap: Theme.spacing.sm,
  },
  membershipStripActive: {
    backgroundColor: '#FFF9EE',
    borderColor: '#E8D5AA',
  },
  membershipIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3EAD7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  membershipCopy: {
    flex: 1,
  },
  membershipTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  membershipTitle: {
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  trialBadge: {
    backgroundColor: Theme.colors.accentHoney,
    paddingVertical: 1,
    paddingHorizontal: 5,
    borderRadius: 4,
  },
  trialBadgeText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: Theme.typography.weights.bold,
  },
  membershipSub: {
    fontSize: 11,
    color: Theme.colors.textSecondary,
    marginTop: 2,
    lineHeight: 15,
  },
  membershipAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  membershipActionText: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.accentRose,
  },

  // 3. Quick Navigation Hub
  quickNavSection: {
    marginBottom: Theme.spacing.lg,
  },
  sectionEyebrow: {
    fontSize: 11,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textSecondary,
    letterSpacing: 0.8,
    marginBottom: Theme.spacing.sm,
    paddingHorizontal: 4,
  },
  quickNavGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Theme.spacing.sm,
  },
  quickNavTile: {
    flexBasis: '48%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    padding: Theme.spacing.md,
    gap: Theme.spacing.sm,
  },
  quickNavIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickNavText: {
    flex: 1,
  },
  quickNavTitle: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  quickNavSub: {
    fontSize: 10,
    color: Theme.colors.textSecondary,
    marginTop: 1,
  },

  // 4. Daily Stitching & Rewards Hub
  dailySection: {
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.lg,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    padding: Theme.spacing.md,
    marginBottom: Theme.spacing.lg,
  },
  dailyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Theme.spacing.md,
    paddingBottom: Theme.spacing.xs,
  },
  dailyHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dailyHeaderTitle: {
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  resetBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F4EDE1',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: Theme.radii.full,
    gap: 4,
  },
  resetBadgeText: {
    fontSize: 10,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textSecondary,
  },
  dailyTasksContainer: {
    marginBottom: Theme.spacing.md,
  },
  dailyGroupLabel: {
    fontSize: 11,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textSecondary,
    letterSpacing: 0.5,
    marginBottom: Theme.spacing.sm,
  },
  dailyLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
    paddingVertical: Theme.spacing.sm,
  },
  dailyErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
    paddingVertical: Theme.spacing.xs,
  },
  tasksList: {
    gap: Theme.spacing.sm,
  },
  taskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAF7F2',
    borderRadius: Theme.radii.md,
    borderWidth: 1,
    borderColor: '#EFE6D8',
    padding: 10,
    gap: Theme.spacing.sm,
  },
  taskIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#EBF4F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskContent: {
    flex: 1,
  },
  taskRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  taskTitle: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  taskCoinText: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.accentHoney,
  },
  taskDesc: {
    fontSize: 10,
    color: Theme.colors.textSecondary,
    marginTop: 1,
  },
  taskProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
    marginTop: 5,
  },
  taskProgressBar: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#E6DFD5',
    overflow: 'hidden',
  },
  taskProgressFill: {
    height: '100%',
    backgroundColor: Theme.colors.accentSage,
    borderRadius: 3,
  },
  taskProgressNumbers: {
    fontSize: 10,
    fontWeight: Theme.typography.weights.medium,
    color: Theme.colors.textSecondary,
  },

  // Daily Pool Block
  dailyRewardPoolContainer: {
    borderTopWidth: 1,
    borderTopColor: '#EFE6D8',
    paddingTop: Theme.spacing.md,
  },
  poolHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Theme.spacing.sm,
  },
  poolTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  poolTitle: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  poolMembershipTag: {
    backgroundColor: Theme.colors.accentHoneySoft,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  poolMembershipTagText: {
    fontSize: 9,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  poolAdsTag: {
    backgroundColor: '#F4EDE1',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
  },
  poolAdsTagText: {
    fontSize: 9,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textSecondary,
  },
  premiumClaimBlock: {
    gap: Theme.spacing.xs,
  },
  claimButton: {
    minHeight: 44,
  },
  claimSuccessBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EEF7EF',
    borderRadius: Theme.radii.md,
    padding: Theme.spacing.sm,
    gap: 8,
  },
  claimSuccessText: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textPrimary,
    flex: 1,
  },
  claimStatusMutedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAF7F2',
    borderRadius: Theme.radii.md,
    padding: Theme.spacing.sm,
    gap: 6,
  },
  claimStatusMutedText: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    flex: 1,
  },
  adRewardBlock: {
    gap: Theme.spacing.xs,
  },
  adPerkNote: {
    fontSize: 10,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    marginTop: 2,
  },
  adSuccessText: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.success,
    fontWeight: Theme.typography.weights.semibold,
    textAlign: 'center',
  },
  poolInfoMuted: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    paddingVertical: 6,
  },

  // 5. Tabs
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
  errorText: {
    color: Theme.colors.error,
    fontSize: Theme.typography.sizes.xs,
  },
  retryLinkText: {
    color: Theme.colors.accentTeal,
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.bold,
  },
  mutedText: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.xs,
  },
  pressed: {
    opacity: 0.72,
  },
});
