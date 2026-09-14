import React from 'react';
import { StyleSheet, View, Text, ActivityIndicator, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Theme } from '../theme/theme';
import { Card } from './Card';
import { Button } from './Button';
import { useRewardDay } from '../api/economy';
import { adRewardMessageKey, useRewardedAdFlow } from '../hooks/useRewardedAdFlow';
import { OfflineError } from '../api/networkErrors';
import { isServerApiError, localizeServerError } from '../api/localizeServerError';
import { useTranslation } from 'react-i18next';

/** Hardcoded 10 coin reward per ad attempt, locked by ADR-0011 / ADR-0033. */
const AD_REWARD_COIN = 10;

function formatTimeRemaining(resetsAt: string, t: (key: string, values?: Record<string, number>) => string): string {
  const diffMs = new Date(resetsAt).getTime() - Date.now();
  if (diffMs <= 0) return t('home.dailySection.resetting');
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return t('home.dailySection.resetsInMinutes', { minutes });
  return t('home.dailySection.resetsInHoursMinutes', { hours, minutes });
}

interface RewardedAdCardProps {
  /** Identity established flag from the caller (both Guest and Registered users are allowed). */
  enabled: boolean;
}

export function RewardedAdCard({ enabled }: RewardedAdCardProps) {
  const { t } = useTranslation('profile');
  const { data, isLoading, isError, error: rewardDayError, refetch } = useRewardDay();
  const isOffline = rewardDayError instanceof OfflineError;
  const flow = useRewardedAdFlow({
    localizeAttemptError: (err) => isServerApiError(err) ? localizeServerError(err) : t('home.dailyPool.adAttemptFailedDefault'),
    localizeClaimError: (err) => isServerApiError(err) ? localizeServerError(err) : t('home.dailyPool.claimFailedGeneric'),
    localizeLoadError: () => t('home.dailyPool.adLoadFailedDefault'),
    localizeVerificationExpired: () => t('home.dailyPool.adRewardExpired'),
  });
  const { status } = flow;

  if (!enabled || status === 'unavailable') {
    return null;
  }

  if (isLoading) {
    return (
      <Card style={styles.card}>
        <View style={styles.centerRow}>
          <ActivityIndicator color={Theme.colors.accentRose} />
        </View>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card style={styles.card}>
        <View style={styles.centerRow}>
          <Ionicons name="cloud-offline-outline" size={20} color={Theme.colors.error} />
          <Text style={styles.errorText}>
            {isOffline
              ? t('rewardedAdCard.offline')
              : t('rewardedAdCard.unavailable')}
          </Text>
          <Pressable onPress={() => refetch()} hitSlop={8}>
            <Text style={styles.retryText}>{t('home.dailySection.retry')}</Text>
          </Pressable>
        </View>
      </Card>
    );
  }

  const resetsIn = formatTimeRemaining(data.resetsAt, t);

  if (data.premiumClaimed || data.adsRemaining <= 0 || data.coinsRemaining < AD_REWARD_COIN) {
    return (
      <Card style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('home.dailyPool.rewardedAds')}</Text>
          <View style={styles.balanceBadge}>
            <Ionicons name="disc-outline" size={14} color={Theme.colors.accentHoney} />
            <Text style={styles.balanceText}>{data.balance}</Text>
          </View>
        </View>
        <Text style={styles.resetText}>{resetsIn}</Text>
        <Text style={styles.disabledTextContent}>
          {data.premiumClaimed
            ? t('rewardedAdCard.premiumClaimClosedPool')
            : t('rewardedAdCard.allRewardsClaimed')}
        </Text>
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('home.dailyPool.rewardedAds')}</Text>
        <View style={styles.balanceBadge}>
          <Ionicons name="disc-outline" size={14} color={Theme.colors.accentHoney} />
          <Text style={styles.balanceText}>{data.balance}</Text>
        </View>
      </View>
      <Text style={styles.resetText}>{resetsIn}</Text>

      <View style={styles.infoRow}>
        <Ionicons name="film-outline" size={20} color={Theme.colors.accentTeal} />
        <Text style={styles.bodyText}>
          {t('rewardedAdCard.remaining', {
            count: data.adsRemaining,
            coins: data.coinsRemaining,
          })}
        </Text>
      </View>

      <Button
        title={t('rewardedAdCard.watchForCoins', { count: AD_REWARD_COIN })}
        onPress={flow.watch}
        disabled={flow.attemptPending || flow.isVerifying}
        loading={flow.attemptPending || flow.isVerifying}
        variant="honey"
        style={styles.button}
      />

      {flow.message && (
        <Text style={styles.successMessage}>
          {t(adRewardMessageKey(flow.message))}
        </Text>
      )}

      {flow.errorMessage && (
        <Text style={styles.errorMessage}>
          {flow.errorMessage}
        </Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: Theme.spacing.xl,
  },
  centerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Theme.spacing.sm,
    paddingVertical: Theme.spacing.sm,
  },
  errorText: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.error,
  },
  retryText: {
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.accentTeal,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  balanceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.xs,
    backgroundColor: Theme.colors.accentHoneySoft,
    paddingVertical: Theme.spacing.xs,
    paddingHorizontal: Theme.spacing.sm,
    borderRadius: Theme.radii.full,
  },
  balanceText: {
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  resetText: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    marginTop: Theme.spacing.xs,
    marginBottom: Theme.spacing.md,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
    marginBottom: Theme.spacing.md,
  },
  bodyText: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textPrimary,
  },
  disabledTextContent: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    fontStyle: 'italic',
  },
  button: {
    marginTop: Theme.spacing.sm,
  },
  successMessage: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.success,
    fontWeight: Theme.typography.weights.semibold,
    textAlign: 'center',
    marginTop: Theme.spacing.sm,
  },
  errorMessage: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.error,
    textAlign: 'center',
    marginTop: Theme.spacing.sm,
  },
});
