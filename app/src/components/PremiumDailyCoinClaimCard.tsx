import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useMembership, usePremiumDailyClaim } from '@/api/membership';
import { Theme } from '@/theme/theme';
import { formatDate } from '@/i18n';
import { isServerApiError, localizeServerError } from '@/api/localizeServerError';

import { Button } from './Button';
import { Card } from './Card';

interface PremiumDailyCoinClaimCardProps {
  readonly enabled: boolean;
}

export function PremiumDailyCoinClaimCard({ enabled }: PremiumDailyCoinClaimCardProps) {
  const { t, i18n: i18nInstance } = useTranslation('profile');
  const locale = i18nInstance.language;
  const router = useRouter();
  const membership = useMembership(enabled);
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
          <Text style={styles.title}>{t('premiumDailyCoinClaimCard.title')}</Text>
          <Text style={styles.description}>
            {t('premiumDailyCoinClaimCard.description')}
          </Text>
        </View>
      </View>

      {!enabled ? (
        <Text style={styles.muted}>{t('premiumDailyCoinClaimCard.connectPrompt')}</Text>
      ) : membership.isLoading ? (
        <View style={styles.statusRow} testID="premium-daily-claim-loading">
          <ActivityIndicator size="small" color={Theme.colors.accentHoney} />
          <Text style={styles.muted}>{t('premiumDailyCoinClaimCard.checkingReward')}</Text>
        </View>
      ) : membership.isError ? (
        <View style={styles.stateBlock}>
          <Text style={styles.errorText}>
            {isServerApiError(membership.error)
              ? localizeServerError(membership.error)
              : t('premiumDailyCoinClaimCard.unavailableGeneric')}
          </Text>
          <Button title={t('premiumDailyCoinClaimCard.tryAgain')} onPress={() => void membership.refetch()} variant="secondary" />
        </View>
      ) : !activeMembership ? (
        <LockedState onOpenPremium={openPremium} t={t} />
      ) : (
        <View style={styles.stateBlock}>
          {result !== undefined ? (
            <View style={styles.result} testID="premium-daily-claim-result">
              <Ionicons name="checkmark-circle" size={20} color={Theme.colors.success} />
              <Text style={styles.resultText}>
                {result.amount > 0
                  ? t('premiumDailyCoinClaimCard.resultAdded', { amount: result.amount, balance: result.balance })
                  : t('premiumDailyCoinClaimCard.poolAlreadyClosed')}
              </Text>
            </View>
          ) : claimed ? (
            <Text style={styles.muted}>{t('premiumDailyCoinClaimCard.alreadyClaimed')}</Text>
          ) : exhausted ? (
            <Text style={styles.muted}>
              {t('premiumDailyCoinClaimCard.poolExhausted')}
            </Text>
          ) : (
            <Text style={styles.availability}>{t('premiumDailyCoinClaimCard.availableNow', { count: coinsAvailable })}</Text>
          )}

          {dailyClaim?.resetsAt && (
            <Text style={styles.resetText}>
              {t('premiumDailyCoinClaimCard.resetsAt', {
                date: formatDate(new Date(dailyClaim.resetsAt), locale, { dateStyle: 'medium', timeStyle: 'short' }),
              })}
            </Text>
          )}

          {claim.error && (
            <Text style={styles.errorText}>
              {isServerApiError(claim.error)
                ? localizeServerError(claim.error)
                : t('premiumDailyCoinClaimCard.unavailableGeneric')}
            </Text>
          )}

          {!claimed && !exhausted && result === undefined && (
            <Button
              title={claim.error ? t('premiumDailyCoinClaimCard.claimButtonRetry') : t('premiumDailyCoinClaimCard.claimButtonInstant', { count: coinsAvailable })}
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

function LockedState({ onOpenPremium, t }: { readonly onOpenPremium: () => void; readonly t: (key: string) => string }) {
  return (
    <View style={styles.stateBlock} testID="premium-daily-claim-locked">
      <View style={styles.statusRow}>
        <Ionicons name="lock-closed-outline" size={17} color={Theme.colors.textSecondary} />
        <Text style={styles.muted}>
          {t('premiumDailyCoinClaimCard.lockedDescription')}
        </Text>
      </View>
      <Button title={t('premiumDailyCoinClaimCard.viewPremiumPlans')} onPress={onOpenPremium} variant="rose" />
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
