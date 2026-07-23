import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, ActivityIndicator, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Theme } from '../theme/theme';
import { Card } from './Card';
import { Button } from './Button';
import { useRewardDay, useOpenAdAttempt } from '../api/economy';
import { useRewardedAd } from '../hooks/useRewardedAd';

/** Hardcoded 10 coin reward per ad attempt, locked by ADR-0011 / ADR-0033. */
const AD_REWARD_COIN = 10;

function formatTimeRemaining(resetsAt: string): string {
  const diffMs = new Date(resetsAt).getTime() - Date.now();
  if (diffMs <= 0) return 'Resetting…';
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `Resets in ${minutes}m`;
  return `Resets in ${hours}h ${minutes}m`;
}

interface RewardedAdCardProps {
  /** Identity established flag from the caller (both Guest and Registered users are allowed). */
  enabled: boolean;
}

export function RewardedAdCard({ enabled }: RewardedAdCardProps) {
  const { data, isLoading, isError, refetch } = useRewardDay();
  const { mutateAsync: openAdAttempt } = useOpenAdAttempt();
  const queryClient = useQueryClient();

  const [attempt, setAttempt] = useState<{ nonce: string; expiresAt: string } | null>(null);
  const [attemptPending, setAttemptPending] = useState(false);
  const [earned, setEarned] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const { status, show, error } = useRewardedAd({
    serverSideVerification: attempt?.nonce ? { customData: attempt.nonce } : undefined,
    onEarnedReward: () => {
      setEarned(true);
    },
  });

  const prevStatusRef = useRef(status);

  useEffect(() => {
    if (attemptPending && status === 'loaded') {
      show();
    }
  }, [status, attemptPending, show]);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;

    if (attemptPending && prevStatus === 'showing' && status !== 'showing') {
      // Ad finished (either dismissed or error during show)
      queryClient.invalidateQueries({ queryKey: ['economy', 'reward-day'] });
      queryClient.invalidateQueries({ queryKey: ['economy', 'balance'] });
      setAttempt(null);
      setAttemptPending(false);
      setEarned(false);
    }
  }, [status, attemptPending, queryClient]);

  useEffect(() => {
    if (attemptPending && status === 'error') {
      setLocalError(error?.message || 'Failed to load ad');
      setAttempt(null);
      setAttemptPending(false);
    }
  }, [status, attemptPending, error]);

  const handleWatchAd = async () => {
    try {
      setLocalError(null);
      setAttemptPending(true);
      setEarned(false);
      const attemptData = await openAdAttempt();
      setAttempt(attemptData);
    } catch (err) {
      setAttemptPending(false);
      setLocalError(err instanceof Error ? err.message : 'Failed to open ad attempt');
    }
  };

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
          <Text style={styles.errorText}>Couldn't load Reward Day status</Text>
          <Pressable onPress={() => refetch()} hitSlop={8}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      </Card>
    );
  }

  const resetsIn = formatTimeRemaining(data.resetsAt);

  if (data.premiumClaimed || data.adsRemaining <= 0 || data.coinsRemaining < AD_REWARD_COIN) {
    return (
      <Card style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Rewarded Ads</Text>
          <View style={styles.balanceBadge}>
            <Ionicons name="disc-outline" size={14} color={Theme.colors.accentHoney} />
            <Text style={styles.balanceText}>{data.balance}</Text>
          </View>
        </View>
        <Text style={styles.resetText}>{resetsIn}</Text>
        <Text style={styles.disabledTextContent}>
          {data.premiumClaimed
            ? 'Your Premium daily claim closed today\'s shared coin pool.'
            : 'You\'ve claimed all ad rewards for today. Come back tomorrow!'}
        </Text>
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Rewarded Ads</Text>
        <View style={styles.balanceBadge}>
          <Ionicons name="disc-outline" size={14} color={Theme.colors.accentHoney} />
          <Text style={styles.balanceText}>{data.balance}</Text>
        </View>
      </View>
      <Text style={styles.resetText}>{resetsIn}</Text>

      <View style={styles.infoRow}>
        <Ionicons name="film-outline" size={20} color={Theme.colors.accentTeal} />
        <Text style={styles.bodyText}>
          {data.adsRemaining} ad{data.adsRemaining > 1 ? 's' : ''} left today ({data.coinsRemaining} coins available)
        </Text>
      </View>

      <Button
        title={`Watch Ad for ${AD_REWARD_COIN} Coins`}
        onPress={handleWatchAd}
        disabled={attemptPending}
        loading={attemptPending}
        variant="honey"
        style={styles.button}
      />

      {earned && (
        <Text style={styles.successMessage}>
          Reward earned! Verifying…
        </Text>
      )}

      {localError && (
        <Text style={styles.errorMessage}>
          {localError}
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
