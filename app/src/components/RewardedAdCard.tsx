import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, View, Text, ActivityIndicator, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { Theme } from '../theme/theme';
import { Card } from './Card';
import { Button } from './Button';
import { useRewardDay, useOpenAdAttempt, useClaimAdReward } from '../api/economy';
import { useRewardedAd } from '../hooks/useRewardedAd';
import { OfflineError } from '../api/networkErrors';

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
  const { data, isLoading, isError, error: rewardDayError, refetch } = useRewardDay();
  const isOffline = rewardDayError instanceof OfflineError;
  const { mutateAsync: openAdAttempt } = useOpenAdAttempt();
  const { mutateAsync: claimAdReward } = useClaimAdReward();
  const queryClient = useQueryClient();

  const [attempt, setAttempt] = useState<{ nonce: string; expiresAt: string } | null>(null);
  const [attemptPending, setAttemptPending] = useState(false);
  const [earned, setEarned] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const attemptRef = useRef(attempt);
  attemptRef.current = attempt;
  const activeNonceRef = useRef<string | null>(null);
  const claimingNonceRef = useRef<Set<string>>(new Set());

  const handleClaim = useCallback(
    async (nonce: string) => {
      if (claimingNonceRef.current.has(nonce)) {
        return;
      }
      claimingNonceRef.current.add(nonce);
      try {
        await claimAdReward(nonce);
        activeNonceRef.current = null;
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['economy', 'reward-day'] }),
          queryClient.invalidateQueries({ queryKey: ['economy', 'balance'] }),
        ]);
      } catch (err: unknown) {
        claimingNonceRef.current.delete(nonce);
        console.error('[RewardedAdCard] Failed to claim client ad reward:', err);
        const msg = err instanceof Error ? err.message : String(err);
        setLocalError(`Claim failed: ${msg}`);
      }
    },
    [claimAdReward, queryClient],
  );

  const { status, show, error } = useRewardedAd({
    serverSideVerification: attempt?.nonce ? { customData: attempt.nonce } : undefined,
    onEarnedReward: async () => {
      setEarned(true);
      const nonceToClaim = activeNonceRef.current || attemptRef.current?.nonce;
      if (nonceToClaim) {
        await handleClaim(nonceToClaim);
      }
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
      const pendingNonce = activeNonceRef.current;
      if (pendingNonce && !claimingNonceRef.current.has(pendingNonce)) {
        handleClaim(pendingNonce).finally(() => {
          queryClient.invalidateQueries({ queryKey: ['economy', 'reward-day'] });
          queryClient.invalidateQueries({ queryKey: ['economy', 'balance'] });
          setAttempt(null);
          setAttemptPending(false);
        });
      } else {
        queryClient.invalidateQueries({ queryKey: ['economy', 'reward-day'] });
        queryClient.invalidateQueries({ queryKey: ['economy', 'balance'] });
        setAttempt(null);
        setAttemptPending(false);
      }
    }
  }, [status, attemptPending, queryClient, handleClaim]);

  useEffect(() => {
    if (attemptPending && status === 'error') {
      setLocalError(error?.message || 'Failed to load ad');
      activeNonceRef.current = null;
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
      activeNonceRef.current = attemptData.nonce;
      setAttempt(attemptData);
    } catch (err) {
      activeNonceRef.current = null;
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
          <Text style={styles.errorText}>
            {isOffline ? "You're offline - Reward Day needs a connection" : "Couldn't load Reward Day status"}
          </Text>
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
