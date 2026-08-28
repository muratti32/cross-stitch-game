import React, { useState } from 'react';
import { Alert, ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import {
  type MyPublishedPattern,
  useAppealCatalogMetadataRevision,
  useMyPublishedPatterns,
  useWithdrawCatalogMetadataRevision,
} from '@/api/catalogMetadataRevisions';
import { absolutePreviewUrl, absoluteThumbnailUrls } from '@/api/catalog';
import { useWithdrawCommunityPattern } from '@/api/catalogWithdrawals';
import { isServerApiError, localizeServerError } from '@/api/localizeServerError';
import { Button, Card, EmptyState, Screen, PatternImage } from '@/components';
import { useIdentityStore } from '@/identity/guestIdentity';
import { formatDate } from '@/i18n';
import { Theme } from '@/theme/theme';

export default function PublishedPatternsScreen() {
  const { t, i18n: i18nInstance } = useTranslation('profile');
  const locale = i18nInstance.language;
  const accountId = useIdentityStore((state) => state.accountId);
  const isAccount = useIdentityStore((state) => state.isAccount);
  const query = useMyPublishedPatterns(accountId, isAccount);
  const withdrawRevision = useWithdrawCatalogMetadataRevision(accountId);
  const withdrawPattern = useWithdrawCommunityPattern(accountId);
  const appeal = useAppealCatalogMetadataRevision(accountId);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [withdrawingPatternId, setWithdrawingPatternId] = useState<string | null>(null);
  const [appealId, setAppealId] = useState<string | null>(null);
  const [appealNote, setAppealNote] = useState('');
  const [appealError, setAppealError] = useState<string | null>(null);

  const describe = (caught: unknown): string =>
    isServerApiError(caught)
      ? localizeServerError(caught)
      : caught instanceof Error
        ? caught.message
        : String(caught);

  const submitWithdraw = async (id: string) => {
    setWithdrawingId(id);
    try {
      await withdrawRevision.mutateAsync(id);
    } catch (caught: unknown) {
      Alert.alert(t('publishedPatterns.withdrawRevisionFailedTitle'), describe(caught));
    } finally {
      setWithdrawingId(null);
    }
  };

  const submitPatternWithdrawal = async (id: string) => {
    if (withdrawPattern.isPending) return;
    setWithdrawingPatternId(id);
    try {
      await withdrawPattern.mutateAsync(id);
      Alert.alert(
        t('publishedPatterns.withdrawPatternSuccessTitle'),
        t('publishedPatterns.withdrawPatternSuccessBody'),
      );
    } catch (caught: unknown) {
      Alert.alert(t('publishedPatterns.withdrawPatternFailedTitle'), describe(caught));
    } finally {
      setWithdrawingPatternId(null);
    }
  };

  const confirmPatternWithdrawal = (item: MyPublishedPattern) => {
    if (withdrawPattern.isPending || item.status !== 'available') return;
    Alert.alert(
      t('publishedPatterns.withdrawConfirmTitle'),
      t('publishedPatterns.withdrawConfirmBody', { title: item.title }),
      [
        { style: 'cancel', text: t('publishedPatterns.withdrawConfirmCancel') },
        {
          onPress: () => void submitPatternWithdrawal(item.id),
          style: 'destructive',
          text: t('publishedPatterns.withdrawConfirmAction'),
        },
      ],
    );
  };

  const submitAppeal = async (id: string) => {
    setAppealError(null);
    try {
      await appeal.mutateAsync({ id, note: appealNote });
      setAppealId(null);
      setAppealNote('');
    } catch (caught: unknown) {
      setAppealError(describe(caught));
    }
  };

  return (
    <Screen style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityLabel={t('common.goBackAccessibilityLabel')} hitSlop={12} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color={Theme.colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('publishedPatterns.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      {query.isPending ? (
        <ActivityIndicator style={styles.loader} color={Theme.colors.accentRose} />
      ) : query.isError ? (
        <EmptyState
          icon="cloud-offline-outline"
          title={t('publishedPatterns.unavailableTitle')}
          body={
            query.error
              ? isServerApiError(query.error)
                ? localizeServerError(query.error)
                : t('publishedPatterns.unavailableDefault')
              : t('publishedPatterns.unavailableDefault')
          }
          actionLabel={t('common.tryAgain')}
          onAction={() => void query.refetch()}
          actionVariant="rose"
        />
      ) : (query.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon="albums-outline"
          title={t('publishedPatterns.emptyTitle')}
          body={t('publishedPatterns.emptyBody')}
          actionLabel={t('publishedPatterns.emptyAction')}
          onAction={() => router.back()}
          actionVariant="sage"
        />
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={query.data}
          keyExtractor={(item) => item.id}
          onRefresh={() => void query.refetch()}
          refreshing={query.isRefetching}
          renderItem={({ item }) => (
            <PatternCard
              appealError={appealId === item.id ? appealError : null}
              appealId={appealId}
              appealNote={appealNote}
              appealSubmitting={appeal.isPending && appealId === item.id}
              item={item}
              locale={locale}
              t={t}
              withdrawingRevision={withdrawRevision.isPending && withdrawingId === item.id}
              withdrawingPattern={withdrawPattern.isPending && withdrawingPatternId === item.id}
              onAppealNoteChange={setAppealNote}
              onCancelAppeal={() => { setAppealId(null); setAppealNote(''); setAppealError(null); }}
              onOpenAppeal={() => { setAppealId(item.id); setAppealNote(''); setAppealError(null); }}
              onReviseMetadata={() =>
                router.push(`/(tabs)/(profile)/revise-pattern-metadata?patternId=${item.id}`)
              }
              onSubmitAppeal={() => {
                if (item.latestRevision !== null) void submitAppeal(item.latestRevision.id);
              }}
              onWithdraw={() => {
                if (item.latestRevision !== null) void submitWithdraw(item.latestRevision.id);
              }}
              onWithdrawPattern={() => confirmPatternWithdrawal(item)}
            />
          )}
        />
      )}
    </Screen>
  );
}

function PatternCard({
  appealError, appealId, appealNote, appealSubmitting, item, locale, onAppealNoteChange, onCancelAppeal,
  onOpenAppeal, onReviseMetadata, onSubmitAppeal, onWithdraw, onWithdrawPattern, t,
  withdrawingPattern, withdrawingRevision,
}: {
  appealError: string | null; appealId: string | null; appealNote: string; appealSubmitting: boolean;
  item: MyPublishedPattern; locale: string;
  onAppealNoteChange: (value: string) => void; onCancelAppeal: () => void; onOpenAppeal: () => void;
  onReviseMetadata: () => void; onSubmitAppeal: () => void; onWithdraw: () => void;
  onWithdrawPattern: () => void; t: (key: string, options?: Record<string, unknown>) => string;
  withdrawingPattern: boolean; withdrawingRevision: boolean;
}) {
  const revision = item.latestRevision;
  const available = item.status === 'available';
  const metadataActionsAvailable = available || item.status === 'review_hold';
  const canWithdraw = metadataActionsAvailable && revision !== null && (revision.status === 'pending' || revision.status === 'appeal_pending');
  const canAppeal = metadataActionsAvailable && revision !== null && revision.status === 'rejected';
  const appealOpen = metadataActionsAvailable && appealId === item.id;
  return (
    <Card style={styles.card}>
      <View style={styles.thumbRow}>
        <PatternImage
          assets={{
            thumbnailUrls: absoluteThumbnailUrls(item.thumbnailUrls),
            previewUrl: absolutePreviewUrl(item.previewUrl),
          }}
          variant="browsing"
          style={styles.thumbImage}
        />
        <View style={styles.thumbContent}>
          <View style={styles.titleRow}>
            <Text numberOfLines={2} style={styles.title}>{item.title}</Text>
            {(item.status !== 'available' || revision !== null) && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>
                  {item.status === 'withdrawn'
                    ? t('publishedPatterns.withdrawnFromCatalog')
                    : item.status === 'review_hold'
                      ? t('publishedPatterns.underReviewHold')
                      : t(`revisionStatus.${revision!.status}`)}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.meta}>
            {t('publishedPatterns.meta', { category: item.categoryCode, date: formatDate(new Date(item.publishedAt), locale) })}
          </Text>
        </View>
      </View>
      {revision !== null && revision.rejectionReason !== null && (
        <View style={styles.rejection}>
          {/* #165: same structured-reason-vs-moderator-note split as
              submissions.tsx's SubmissionCard. */}
          <Text style={styles.rejectionTitle}>{t(`rejectionReasons.${revision.rejectionReason}`)}</Text>
          {revision.rejectionNote !== null && <Text style={styles.rejectionNote}>{revision.rejectionNote}</Text>}
        </View>
      )}
      {item.status === 'withdrawn' && (
        <Text style={styles.help}>{t('publishedPatterns.withdrawnHelp')}</Text>
      )}
      {item.status === 'review_hold' && (
        <Text style={styles.help}>{t('publishedPatterns.reviewHoldHelp')}</Text>
      )}
      <View style={styles.actions}>
        {metadataActionsAvailable && item.canSubmitRevision && (
          <Button title={t('publishedPatterns.reviseAction')} variant="secondary" onPress={onReviseMetadata} style={styles.action} />
        )}
        {canWithdraw && (
          <Button title={t('publishedPatterns.withdrawRevisionAction')} variant="rose" loading={withdrawingRevision} onPress={onWithdraw} style={styles.action} />
        )}
        {canAppeal && !appealOpen && (
          <Button title={t('publishedPatterns.appealAction')} variant="secondary" onPress={onOpenAppeal} style={styles.action} />
        )}
      </View>
      {available && (
        <Button
          title={t('publishedPatterns.withdrawFromCatalogAction')}
          variant="rose"
          loading={withdrawingPattern}
          onPress={onWithdrawPattern}
        />
      )}
      {appealOpen && (
        <View style={styles.appealForm}>
          <Text style={styles.help}>{t('publishedPatterns.appealHelp')}</Text>
          <TextInput
            accessibilityLabel={t('publishedPatterns.appealNoteAccessibilityLabel')}
            maxLength={1000}
            multiline
            onChangeText={onAppealNoteChange}
            placeholder={t('publishedPatterns.appealNotePlaceholder')}
            placeholderTextColor={Theme.colors.textSecondary}
            style={styles.input}
            textAlignVertical="top"
            value={appealNote}
          />
          {appealError !== null && <Text style={styles.error}>{appealError}</Text>}
          <View style={styles.actions}>
            <Button title={t('publishedPatterns.cancelAction')} variant="secondary" onPress={onCancelAppeal} style={styles.action} />
            <Button title={t('publishedPatterns.submitAppealAction')} variant="rose" loading={appealSubmitting} onPress={onSubmitAppeal} style={styles.action} />
          </View>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: Theme.spacing.lg },
  header: { alignItems: 'center', flexDirection: 'row', paddingVertical: Theme.spacing.lg },
  headerTitle: { color: Theme.colors.textPrimary, flex: 1, fontSize: Theme.typography.sizes.xl, fontWeight: Theme.typography.weights.bold, textAlign: 'center' },
  headerSpacer: { width: 26 },
  loader: { marginTop: Theme.spacing.xxl },
  list: { gap: Theme.spacing.md, paddingBottom: Theme.spacing.xxl },
  card: { gap: Theme.spacing.md },
  thumbRow: { alignItems: 'center', flexDirection: 'row', gap: Theme.spacing.md },
  thumbImage: { borderRadius: Theme.radii.md, height: 56, width: 56 },
  thumbContent: { flex: 1, gap: Theme.spacing.xs },
  titleRow: { alignItems: 'flex-start', flexDirection: 'row', gap: Theme.spacing.sm },
  title: { color: Theme.colors.textPrimary, flex: 1, fontSize: Theme.typography.sizes.md, fontWeight: Theme.typography.weights.bold },
  badge: { backgroundColor: Theme.colors.accentHoneySoft, borderRadius: Theme.radii.full, paddingHorizontal: Theme.spacing.sm, paddingVertical: Theme.spacing.xs },
  badgeText: { color: Theme.colors.textPrimary, fontSize: Theme.typography.sizes.xs, fontWeight: Theme.typography.weights.semibold },
  meta: { color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.xs },
  rejection: { backgroundColor: Theme.colors.accentHoneySoft, borderRadius: Theme.radii.md, gap: Theme.spacing.xs, padding: Theme.spacing.md },
  rejectionTitle: { color: Theme.colors.error, fontSize: Theme.typography.sizes.sm, fontWeight: Theme.typography.weights.bold },
  rejectionNote: { color: Theme.colors.textPrimary, fontSize: Theme.typography.sizes.sm, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: Theme.spacing.sm },
  action: { flex: 1 },
  error: { color: Theme.colors.error, fontSize: Theme.typography.sizes.sm },
  help: { color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.sm, lineHeight: 20 },
  appealForm: { gap: Theme.spacing.md },
  input: { backgroundColor: Theme.colors.background, borderColor: Theme.colors.border, borderRadius: Theme.radii.md, borderWidth: 1, color: Theme.colors.textPrimary, minHeight: 100, padding: Theme.spacing.md },
});
