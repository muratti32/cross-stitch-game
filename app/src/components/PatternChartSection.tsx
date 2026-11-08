import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { Card } from './Card';
import { Theme } from '../theme/theme';
import { formatNumber } from '../i18n';
import { useIdentityStore } from '../identity/guestIdentity';
import { isServerApiError, localizeServerError } from '../api/localizeServerError';
import { isRemovedChartError, usePatternChartAccess, usePurchasePatternChart } from '../api/patternCharts';
import { usePatternChartGeneration } from '../hooks/usePatternChartGeneration';
import { usePatternChartRemoval } from '../hooks/usePatternChartRemoval';
import { useLocalArtifactChecksum } from '../hooks/useLocalArtifactChecksum';
import { decideChartSection } from '../pattern-chart/chartSectionState';
import { presentChartError } from '../pattern-chart/chartErrorPresentation';
import type { PatternData } from '../pattern-artifact';

interface PatternChartSectionProps {
  patternId: string;
  /** `detail` may sell the chart; `compact` (celebration, history) only ever generates one already owned. */
  variant: 'detail' | 'compact';
  /** False for a Community or Personal Pattern. Unknown (undefined) lets the server decide for Registered Accounts. */
  isOfficial?: boolean;
  /** Detail only: the player may already start this pattern (free or unlocked). */
  canStart?: boolean;
  /** Pattern data already in memory, e.g. the open stitching session. */
  pattern?: PatternData;
  localChecksum?: string | null;
  /** History reopens a finished pattern, so the action reads Regenerate. */
  regenerate?: boolean;
  /** This device holds a completed session of the pattern: draw at once, even offline. */
  locallyCompleted?: boolean;
}

export function PatternChartSection({
  patternId,
  variant,
  isOfficial,
  canStart = false,
  pattern,
  localChecksum,
  regenerate = false,
  locallyCompleted = false,
}: PatternChartSectionProps) {
  const { t, i18n } = useTranslation('catalog');
  const locale = i18n.language;
  const router = useRouter();
  const isAuthenticated = useIdentityStore((state) => state.isAuthenticated);
  const isAccount = useIdentityStore((state) => state.isAccount);
  const access = usePatternChartAccess(patternId, isOfficial !== false);
  const purchase = usePurchasePatternChart();
  const generation = usePatternChartGeneration();
  const [purchaseError, setPurchaseError] = useState<unknown>(null);
  const resolvedChecksum = useLocalArtifactChecksum(patternId, isAccount && !pattern && localChecksum === undefined);
  const checksum = localChecksum ?? resolvedChecksum ?? null;

  const section = decideChartSection({
    isAuthenticated,
    isAccount,
    variant,
    isOfficial,
    canStart,
    hasLocalData: pattern !== undefined || checksum !== null,
    locallyCompleted,
    access: { isLoading: access.isLoading, isError: access.isError, data: access.data },
  });

  // Safety Removal: no image may be drawn.
  const removed = section.removed || (generation.state.phase === 'error' && isRemovedChartError(generation.state.error));
  usePatternChartRemoval(patternId, removed);
  if (removed) return null;

  const renderInContainer = (children: React.ReactNode) =>
    variant === 'detail' ? <Card style={styles.card}>{children}</Card> : <View style={styles.compact}>{children}</View>;

  const renderError = (error: unknown): React.ReactNode => {
    const presentation = presentChartError(error);
    if (presentation.type === 'insufficient') {
      return (
        <View>
          <Text style={styles.error}>
            {t('chart.insufficient', { shortfall: formatNumber(presentation.price - presentation.balance, locale) })}
          </Text>
          <Button
            title={t('detail.insufficientCoins.getCoins')}
            onPress={() => router.push({ pathname: '/(tabs)/(profile)/commerce', params: { category: 'stitch_coin', source: 'stitch_coin_shortfall' } })}
            variant="honey"
            style={styles.button}
          />
        </View>
      );
    }
    let message: string;
    switch (presentation.type) {
      case 'server':
        message = isServerApiError(presentation.error) ? localizeServerError(presentation.error) : t('chart.generateFailed');
        break;
      case 'priceChanged':
        message = t('chart.priceChanged', { price: formatNumber(presentation.price, locale) });
        break;
      case 'key':
        message = t(presentation.key);
        break;
    }
    return <Text style={styles.error} accessibilityRole="alert">{message}</Text>;
  };

  switch (section.kind) {
    case 'hidden':
      return null;
    case 'signIn':
      return renderInContainer(
        <>
          <Text style={styles.title}>{t('chart.title')}</Text>
          <Text style={styles.body}>{t('chart.signIn.body')}</Text>
          <Button
            title={t('chart.signIn.button')}
            onPress={() => router.push('/(tabs)/(settings)/sign-in')}
            variant="secondary"
            style={styles.button}
          />
        </>,
      );
    case 'loading':
      return renderInContainer(
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" color={Theme.colors.accentTeal} />
          <Text style={styles.body}>{t('chart.checking')}</Text>
        </View>,
      );
    case 'error':
      return renderInContainer(
        <>
          <Text style={styles.error} accessibilityRole="alert">{t('chart.loadFailed')}</Text>
          <Button title={t('chart.retry')} onPress={() => void access.refetch()} variant="secondary" style={styles.button} />
        </>,
      );
    case 'buy': {
      const buy = async () => {
        setPurchaseError(null);
        try {
          await purchase.mutateAsync({ patternId, expectedPrice: section.price });
        } catch (error) {
          setPurchaseError(error);
        }
      };
      return renderInContainer(
        <>
          <Text style={styles.title}>{t('chart.title')}</Text>
          <Text style={styles.body}>{t('chart.description')}</Text>
          <Text style={styles.hint}>{t('chart.freeIfCompleted')}</Text>
          {purchaseError !== null && renderError(purchaseError)}
          <Button
            title={purchase.isPending ? t('chart.buying') : t('chart.buy', { price: formatNumber(section.price, locale) })}
            onPress={() => void buy()}
            variant="primary"
            loading={purchase.isPending}
            disabled={purchase.isPending}
            style={styles.button}
          />
        </>,
      );
    }
    case 'generate': {
      const generating = generation.state.phase === 'generating';
      const dialogTitle = t('chart.dialogTitle');
      return renderInContainer(
        <>
          {variant === 'detail' && (
            <>
              <Text style={styles.title}>{t('chart.title')}</Text>
              <Text style={styles.body}>{t('chart.description')}</Text>
            </>
          )}
          {generation.state.phase === 'error' && renderError(generation.state.error)}
          <Button
            title={generating ? t('chart.generating') : regenerate ? t('chart.regenerate') : t('chart.generate')}
            onPress={() => void generation.generate({
              patternId,
              pattern,
              localChecksum: checksum,
              allowRemoteFetch: section.allowRemoteFetch,
              dialogTitle,
            })}
            variant={variant === 'detail' ? 'primary' : 'secondary'}
            loading={generating}
            disabled={generating}
            style={styles.button}
          />
        </>,
      );
    }
  }
}

const styles = StyleSheet.create({
  card: { padding: Theme.spacing.lg, marginTop: Theme.spacing.md },
  compact: { marginTop: Theme.spacing.sm },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.sm },
  title: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
    marginBottom: Theme.spacing.xs,
  },
  body: { fontSize: Theme.typography.sizes.sm, color: Theme.colors.textSecondary, lineHeight: 20 },
  hint: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.accentSage,
    fontWeight: Theme.typography.weights.semibold,
    marginTop: Theme.spacing.xs,
  },
  error: { fontSize: Theme.typography.sizes.sm, color: Theme.colors.error, marginTop: Theme.spacing.sm },
  button: { marginTop: Theme.spacing.md },
});
