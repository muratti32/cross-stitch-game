import React from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { localizeServerError } from '../api/localizeServerError';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Theme } from '../theme/theme';
import { describeDisclosure, type DisclosureLine } from './disclosureModel';
import type { PromotionFailure } from './failure';
import { canCancel, type PromotionHandoff } from './handoff';
import type { PromotionFlowSnapshot } from './promotionRunner';

export interface PromotionHandoffViewProps {
  snapshot: PromotionFlowSnapshot;
  onConfirm: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onContactSupport: () => void;
}

/** Player-facing text for a failed request. The server's own message is never shown (ADR-0051). */
function failureText(failure: PromotionFailure, t: TFunction): string {
  if (failure.key !== 'unexpected') return t(`promotion:error.${failure.key}`);
  return failure.cause ? localizeServerError(failure.cause) : t('errors:generic.failure');
}

function LineList({ lines, t }: { lines: DisclosureLine[]; t: TFunction }) {
  return (
    <View style={styles.lines}>
      {lines.map((line) => (
        <Text key={line.key} style={styles.line}>
          {t(`promotion:disclosure.lines.${line.key}`, { amount: line.amount })}
        </Text>
      ))}
    </View>
  );
}

function DisclosureBody({ handoff, t }: { handoff: Extract<PromotionHandoff, { phase: 'disclosing' }>; t: TFunction }) {
  const disclosure = describeDisclosure(handoff);
  const economy = disclosure.mode === 'economy';
  return (
    <>
      <Text accessibilityRole="header" style={styles.title}>
        {t(economy ? 'promotion:disclosure.economyTitle' : 'promotion:disclosure.dataOnlyTitle')}
      </Text>
      {handoff.notice === 'stale' ? (
        <Text style={styles.notice}>{t('promotion:disclosure.staleNotice')}</Text>
      ) : null}
      <Text style={styles.body}>
        {t(economy ? 'promotion:disclosure.economyIntro' : 'promotion:disclosure.dataOnlyIntro')}
      </Text>
      {economy ? <LineList lines={disclosure.receives} t={t} /> : null}
      {economy && disclosure.movesProgress ? (
        <Text style={styles.body}>{t('promotion:disclosure.progress')}</Text>
      ) : null}
      {disclosure.discards.length > 0 ? (
        <>
          <Text style={styles.subheading}>{t('promotion:disclosure.discardedHeading')}</Text>
          <LineList lines={disclosure.discards} t={t} />
        </>
      ) : null}
      <Text style={styles.footnote}>{t('promotion:disclosure.cancelNote')}</Text>
    </>
  );
}

function modalContent(handoff: PromotionHandoff, t: TFunction): React.ReactNode {
  switch (handoff.phase) {
    case 'captured':
    case 'previewing':
      return <LoadingBody text={t('promotion:loading.preview')} />;
    case 'committing':
      return <LoadingBody text={t('promotion:loading.committing')} />;
    case 'disclosing':
      return <DisclosureBody handoff={handoff} t={t} />;
    case 'syncing':
    case 'needsAttention':
      return null;
  }
}

function LoadingBody({ text }: { text: string }) {
  return (
    <View style={styles.loading} accessibilityRole="progressbar" accessibilityLabel={text}>
      <ActivityIndicator size="large" color={Theme.colors.accentTeal} />
      <Text style={styles.body}>{text}</Text>
    </View>
  );
}

function PromotionModal({
  handoff,
  failure,
  onConfirm,
  onCancel,
  onRetry,
}: Pick<PromotionHandoffViewProps, 'onConfirm' | 'onCancel' | 'onRetry'> & {
  handoff: PromotionHandoff;
  failure: PromotionFailure | null;
}) {
  const { t } = useTranslation(['promotion', 'errors']);
  const cancellable = canCancel(handoff);
  return (
    <Modal transparent animationType="fade" visible onRequestClose={cancellable ? onCancel : undefined}>
      <View style={styles.overlay}>
        <Card style={styles.card}>
          {failure ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {failureText(failure, t)}
            </Text>
          ) : (
            modalContent(handoff, t)
          )}
          <View style={styles.buttons}>
            {failure ? (
              <Button title={t('promotion:actions.retry')} onPress={onRetry} style={styles.button} />
            ) : handoff.phase === 'disclosing' ? (
              <Button title={t('promotion:actions.confirm')} onPress={onConfirm} style={styles.button} />
            ) : null}
            {cancellable ? (
              <Button
                title={t('promotion:actions.cancel')}
                onPress={onCancel}
                variant="secondary"
                style={styles.button}
              />
            ) : null}
          </View>
        </Card>
      </View>
    </Modal>
  );
}

function SyncingPill() {
  const { t } = useTranslation('promotion');
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="none" style={[styles.pillWrap, { top: insets.top + Theme.spacing.sm }]}>
      <View style={styles.pill} accessibilityRole="progressbar" accessibilityLabel={t('syncing.indicator')}>
        <ActivityIndicator size="small" color={Theme.colors.accentTeal} />
        <Text style={styles.pillText}>{t('syncing.indicator')}</Text>
      </View>
    </View>
  );
}

function NeedsAttentionBanner({ onRetry, onContactSupport }: Pick<PromotionHandoffViewProps, 'onRetry' | 'onContactSupport'>) {
  const { t } = useTranslation('promotion');
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bannerWrap, { bottom: insets.bottom + Theme.spacing.md }]}>
      <Card style={styles.banner}>
        <Text accessibilityRole="header" style={styles.bannerTitle}>
          {t('needsAttention.title')}
        </Text>
        <Text style={styles.body}>{t('needsAttention.body')}</Text>
        <View style={styles.buttons}>
          <Button title={t('actions.retry')} onPress={onRetry} style={styles.button} />
          <Button title={t('actions.support')} onPress={onContactSupport} variant="secondary" style={styles.button} />
        </View>
      </Card>
    </View>
  );
}

/**
 * The Guest Data Promotion surfaces (ADR-0027, ADR-0028). Before the commit the
 * flow blocks on a modal the player can leave. After the commit the account is
 * already usable, so a sync is only a quiet indicator and a stuck sync is a
 * banner, never a modal.
 */
export function PromotionHandoffView({ snapshot, onConfirm, onCancel, onRetry, onContactSupport }: PromotionHandoffViewProps) {
  const { handoff, failure } = snapshot;
  if (handoff === null) return null;
  switch (handoff.phase) {
    case 'syncing':
      return <SyncingPill />;
    case 'needsAttention':
      return <NeedsAttentionBanner onRetry={onRetry} onContactSupport={onContactSupport} />;
    default:
      return (
        <PromotionModal handoff={handoff} failure={failure} onConfirm={onConfirm} onCancel={onCancel} onRetry={onRetry} />
      );
  }
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Theme.spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    paddingVertical: Theme.spacing.xl,
    paddingHorizontal: Theme.spacing.lg,
  },
  title: {
    fontSize: Theme.typography.sizes.xl,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
    textAlign: 'center',
    marginBottom: Theme.spacing.md,
  },
  subheading: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textPrimary,
    marginTop: Theme.spacing.sm,
    marginBottom: Theme.spacing.xs,
  },
  body: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Theme.spacing.md,
  },
  notice: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.warning,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: Theme.spacing.md,
  },
  footnote: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    lineHeight: 16,
    marginBottom: Theme.spacing.md,
  },
  error: {
    fontSize: Theme.typography.sizes.md,
    color: Theme.colors.error,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Theme.spacing.lg,
  },
  lines: {
    gap: Theme.spacing.xs,
    marginBottom: Theme.spacing.md,
  },
  line: {
    fontSize: Theme.typography.sizes.md,
    color: Theme.colors.textPrimary,
  },
  loading: {
    alignItems: 'center',
    gap: Theme.spacing.md,
    paddingVertical: Theme.spacing.md,
  },
  buttons: {
    gap: Theme.spacing.sm,
  },
  button: {
    width: '100%',
  },
  pillWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    borderRadius: Theme.radii.full,
    backgroundColor: Theme.colors.card,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  pillText: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
  },
  bannerWrap: {
    position: 'absolute',
    left: Theme.spacing.lg,
    right: Theme.spacing.lg,
  },
  banner: {
    padding: Theme.spacing.lg,
  },
  bannerTitle: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
    textAlign: 'center',
    marginBottom: Theme.spacing.sm,
  },
});
