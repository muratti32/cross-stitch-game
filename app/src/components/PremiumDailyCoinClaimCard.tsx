import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useMembership, usePremiumDailyClaim } from '@/api/membership';
import { Theme } from '@/theme/theme';

import { Button } from './Button';
import { Card } from './Card';

interface PremiumDailyCoinClaimCardProps {
  readonly enabled: boolean;
  readonly isAccount: boolean;
}

export function PremiumDailyCoinClaimCard({ enabled, isAccount }: PremiumDailyCoinClaimCardProps) {
  const router = useRouter();
  const membership = useMembership(enabled && isAccount);
  const claim = usePremiumDailyClaim();

  const openPremium = () => {
    router.push({
      pathname: '/(tabs)/(profile)/commerce',
      params: { category: 'premium', source: 'premium_benefit' },
    });
  };

  const activeMembership = membership.data?.active === true;
  const dailyClaim = membership.data?.dailyClaim;
  const result = claim.data;
  const resultRewardDayRef = useRef<string | null>(null);

  useEffect(() => {
    if (result === undefined) return;
    if (resultRewardDayRef.current === null) {
      resultRewardDayRef.current = dailyClaim?.resetsAt ?? null;
      return;
    }
    if (dailyClaim?.resetsAt && dailyClaim.resetsAt !== resultRewardDayRef.current) {
      resultRewardDayRef.current = null;
      claim.reset();
    }
  }, [claim, dailyClaim?.resetsAt, result]);

  const claimed = result?.claimed === true || dailyClaim?.claimed === true;
  const coinsAvailable = result?.claimed === true ? 0 : dailyClaim?.coinsAvailable ?? 0;
  const exhausted = activeMembership && !claimed && dailyClaim?.coinsAvailable === 0;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={styles.icon}>
          <Ionicons name="diamond-outline" size={20} color={Theme.colors.accentHoney} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Premium Daily Coin Claim</Text>
          <Text style={styles.description}>
            Claim the remainder of today&apos;s shared 30-Coin reward pool.
          </Text>
        </View>
      </View>

      {!enabled ? (
        <Text style={styles.muted}>Connect to the Game Backend to check today&apos;s reward.</Text>
      ) : !isAccount ? (
        <LockedState onOpenPremium={openPremium} />
      ) : membership.isLoading ? (
        <View style={styles.statusRow} testID="premium-daily-claim-loading">
          <ActivityIndicator size="small" color={Theme.colors.accentHoney} />
          <Text style={styles.muted}>Checking today&apos;s Premium reward…</Text>
        </View>
      ) : membership.isError ? (
        <View style={styles.stateBlock}>
          <Text style={styles.errorText}>
            {membership.error instanceof Error
              ? membership.error.message
              : 'Today\'s Premium reward is unavailable.'}
          </Text>
          <Button title="Try again" onPress={() => void membership.refetch()} variant="secondary" />
        </View>
      ) : !activeMembership ? (
        <LockedState onOpenPremium={openPremium} />
      ) : (
        <View style={styles.stateBlock}>
          {result !== undefined ? (
            <View style={styles.result} testID="premium-daily-claim-result">
              <Ionicons name="checkmark-circle" size={20} color={Theme.colors.success} />
              <Text style={styles.resultText}>
                {result.amount > 0
                  ? `${result.amount} Stitch Coins added by the Game Backend. Balance: ${result.balance}.`
                  : 'Today\'s shared reward pool was already closed.'}
              </Text>
            </View>
          ) : claimed ? (
            <Text style={styles.muted}>Already claimed for this Reward Day.</Text>
          ) : exhausted ? (
            <Text style={styles.muted}>
              Today&apos;s shared reward pool is exhausted. It resets at the next Reward Day.
            </Text>
          ) : (
            <Text style={styles.availability}>{coinsAvailable} Stitch Coins available now</Text>
          )}

          {dailyClaim?.resetsAt && (
            <Text style={styles.resetText}>
              Resets {new Date(dailyClaim.resetsAt).toLocaleString()}
            </Text>
          )}

          {claim.error && <Text style={styles.errorText}>{claim.error.message}</Text>}

          {!claimed && !exhausted && result === undefined && (
            <Button
              title={claim.error ? 'Try claim again' : `Claim ${coinsAvailable} Coins`}
              onPress={() => claim.mutate()}
              disabled={coinsAvailable === 0}
              loading={claim.isPending}
              variant="honey"
            />
          )}
        </View>
      )}
    </Card>
  );
}

function LockedState({ onOpenPremium }: { readonly onOpenPremium: () => void }) {
  return (
    <View style={styles.stateBlock} testID="premium-daily-claim-locked">
      <View style={styles.statusRow}>
        <Ionicons name="lock-closed-outline" size={17} color={Theme.colors.textSecondary} />
        <Text style={styles.muted}>
          Premium Membership, including an eligible Monthly Trial, unlocks this daily claim.
        </Text>
      </View>
      <Button title="View Premium plans" onPress={onOpenPremium} variant="rose" />
    </View>
  );
}

const styles = StyleSheet.create({
  availability: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.bold,
  },
  card: { gap: Theme.spacing.md, marginBottom: Theme.spacing.lg },
  description: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.xs,
    lineHeight: 18,
  },
  errorText: { color: Theme.colors.error, fontSize: Theme.typography.sizes.sm },
  header: { alignItems: 'center', flexDirection: 'row', gap: Theme.spacing.sm },
  headerCopy: { flex: 1, gap: Theme.spacing.xs },
  icon: {
    alignItems: 'center',
    backgroundColor: '#FFF7E6',
    borderRadius: Theme.radii.full,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  muted: { color: Theme.colors.textSecondary, flex: 1, fontSize: Theme.typography.sizes.sm },
  resetText: { color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.xs },
  result: {
    alignItems: 'center',
    backgroundColor: '#F0F7F0',
    borderRadius: Theme.radii.md,
    flexDirection: 'row',
    gap: Theme.spacing.sm,
    padding: Theme.spacing.sm,
  },
  resultText: { color: Theme.colors.textPrimary, flex: 1, fontSize: Theme.typography.sizes.sm },
  stateBlock: { gap: Theme.spacing.sm },
  statusRow: { alignItems: 'center', flexDirection: 'row', gap: Theme.spacing.sm },
  title: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.bold,
  },
});
