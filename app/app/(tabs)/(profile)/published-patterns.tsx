import React, { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import {
  type CatalogMetadataRevisionStatus,
  type CatalogRejectionReason,
  type MyPublishedPattern,
  useMyPublishedPatterns,
  useWithdrawCatalogMetadataRevision,
} from '@/api/catalogMetadataRevisions';
import { Button, Card, EmptyState, Screen } from '@/components';
import { useIdentityStore } from '@/identity/guestIdentity';
import { Theme } from '@/theme/theme';

const STATUS_LABELS: Record<CatalogMetadataRevisionStatus, string> = {
  accepted: 'Published', appeal_pending: 'Appeal pending', appeal_upheld: 'Appeal rejected',
  pending: 'In review', rejected: 'Rejected', withdrawn: 'Withdrawn',
};

const REASON_LABELS: Record<CatalogRejectionReason, string> = {
  duplicate_or_spam: 'Duplicate or Spam', publication_rights: 'Publication Rights',
  quality_standard: 'Quality Standard', safety: 'Safety', technical_invalidity: 'Technical Invalidity',
};

export default function PublishedPatternsScreen() {
  const accountId = useIdentityStore((state) => state.accountId);
  const isAccount = useIdentityStore((state) => state.isAccount);
  const query = useMyPublishedPatterns(accountId, isAccount);
  const withdraw = useWithdrawCatalogMetadataRevision(accountId);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submitWithdraw = async (id: string) => {
    setError(null);
    setWithdrawingId(id);
    try {
      await withdraw.mutateAsync(id);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setWithdrawingId(null);
    }
  };

  return (
    <Screen style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="Go back" hitSlop={12} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color={Theme.colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Published Patterns</Text>
        <View style={styles.headerSpacer} />
      </View>

      {query.isPending ? (
        <ActivityIndicator style={styles.loader} color={Theme.colors.accentRose} />
      ) : query.isError ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Patterns Unavailable"
          body={query.error instanceof Error ? query.error.message : 'Could not load your published patterns.'}
          actionLabel="Try Again"
          onAction={() => void query.refetch()}
          actionVariant="rose"
        />
      ) : (query.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon="albums-outline"
          title="No Published Patterns"
          body="Patterns you publish to the Community Catalog appear here."
          actionLabel="Back to Profile"
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
              error={withdrawingId === item.id ? error : null}
              item={item}
              withdrawing={withdraw.isPending && withdrawingId === item.id}
              onReviseMetadata={() =>
                router.push(`/(tabs)/(profile)/revise-pattern-metadata?patternId=${item.id}`)
              }
              onWithdraw={() => {
                if (item.latestRevision !== null) void submitWithdraw(item.latestRevision.id);
              }}
            />
          )}
        />
      )}
    </Screen>
  );
}

function PatternCard({
  error, item, onReviseMetadata, onWithdraw, withdrawing,
}: {
  error: string | null; item: MyPublishedPattern; onReviseMetadata: () => void; onWithdraw: () => void;
  withdrawing: boolean;
}) {
  const revision = item.latestRevision;
  const canWithdraw = revision !== null && (revision.status === 'pending' || revision.status === 'appeal_pending');
  return (
    <Card style={styles.card}>
      <View style={styles.titleRow}>
        <Text numberOfLines={2} style={styles.title}>{item.title}</Text>
        {revision !== null && (
          <View style={styles.badge}><Text style={styles.badgeText}>{STATUS_LABELS[revision.status]}</Text></View>
        )}
      </View>
      <Text style={styles.meta}>{item.categoryCode} · Published {new Date(item.publishedAt).toLocaleDateString()}</Text>
      {revision !== null && revision.rejectionReason !== null && (
        <View style={styles.rejection}>
          <Text style={styles.rejectionTitle}>{REASON_LABELS[revision.rejectionReason]}</Text>
          {revision.rejectionNote !== null && <Text style={styles.rejectionNote}>{revision.rejectionNote}</Text>}
        </View>
      )}
      {error !== null && <Text style={styles.error}>{error}</Text>}
      <View style={styles.actions}>
        {item.canSubmitRevision && (
          <Button title="Revise Metadata" variant="secondary" onPress={onReviseMetadata} style={styles.action} />
        )}
        {canWithdraw && (
          <Button title="Withdraw" variant="rose" loading={withdrawing} onPress={onWithdraw} style={styles.action} />
        )}
      </View>
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
});
