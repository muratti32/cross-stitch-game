import React, { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import {
  type CatalogRejectionReason,
  type CatalogSubmission,
  type CatalogSubmissionStatus,
  useCatalogSubmissions,
  useCreateCatalogAppeal,
} from '@/api/catalogSubmissions';
import { Button, Card, EmptyState, Screen } from '@/components';
import { useIdentityStore } from '@/identity/guestIdentity';
import { Theme } from '@/theme/theme';

const STATUS_LABELS: Record<CatalogSubmissionStatus, string> = {
  accepted: 'Published', appeal_pending: 'Appeal pending', appeal_upheld: 'Appeal rejected',
  precheck_failed: 'Precheck unavailable', precheck_pending: 'Checking', quarantined: 'Needs review',
  rejected: 'Rejected', review_pending: 'In review',
};

const REASON_LABELS: Record<CatalogRejectionReason, string> = {
  duplicate_or_spam: 'Duplicate or Spam', publication_rights: 'Publication Rights',
  quality_standard: 'Quality Standard', safety: 'Safety', technical_invalidity: 'Technical Invalidity',
};

export default function CatalogSubmissionsScreen() {
  const accountId = useIdentityStore((state) => state.accountId);
  const isAccount = useIdentityStore((state) => state.isAccount);
  const query = useCatalogSubmissions(accountId, isAccount);
  const appeal = useCreateCatalogAppeal(accountId);
  const [appealId, setAppealId] = useState<string | null>(null);
  const [appealNote, setAppealNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submitAppeal = async (id: string) => {
    setError(null);
    try {
      await appeal.mutateAsync({ id, note: appealNote });
      setAppealId(null);
      setAppealNote('');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <Screen style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="Go back" hitSlop={12} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color={Theme.colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Catalog Submissions</Text>
        <View style={styles.headerSpacer} />
      </View>

      {query.isPending ? (
        <ActivityIndicator style={styles.loader} color={Theme.colors.accentRose} />
      ) : query.isError ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Submissions Unavailable"
          body={query.error instanceof Error ? query.error.message : 'Could not load your submissions.'}
          actionLabel="Try Again"
          onAction={() => void query.refetch()}
          actionVariant="rose"
        />
      ) : (query.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon="cloud-upload-outline"
          title="No Catalog Submissions"
          body="Submit a synced Personal Pattern from My Creations."
          actionLabel="Back to My Creations"
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
            <SubmissionCard
              appealId={appealId}
              appealNote={appealNote}
              error={appealId === item.id ? error : null}
              item={item}
              submitting={appeal.isPending && appealId === item.id}
              onAppealNoteChange={setAppealNote}
              onCancelAppeal={() => { setAppealId(null); setAppealNote(''); setError(null); }}
              onOpenAppeal={() => { setAppealId(item.id); setAppealNote(''); setError(null); }}
              onSubmitAppeal={() => void submitAppeal(item.id)}
            />
          )}
        />
      )}
    </Screen>
  );
}

function SubmissionCard({
  appealId, appealNote, error, item, onAppealNoteChange, onCancelAppeal, onOpenAppeal,
  onSubmitAppeal, submitting,
}: {
  appealId: string | null; appealNote: string; error: string | null; item: CatalogSubmission;
  onAppealNoteChange: (value: string) => void; onCancelAppeal: () => void; onOpenAppeal: () => void;
  onSubmitAppeal: () => void; submitting: boolean;
}) {
  const canAppeal = item.status === 'rejected' && !item.appealed;
  return (
    <Card style={styles.card}>
      <View style={styles.titleRow}>
        <Text numberOfLines={2} style={styles.title}>{item.title}</Text>
        <View style={styles.badge}><Text style={styles.badgeText}>{STATUS_LABELS[item.status]}</Text></View>
      </View>
      <Text style={styles.meta}>{item.categoryCode} · {new Date(item.createdAt).toLocaleDateString()}</Text>
      <Text numberOfLines={3} style={styles.description}>{item.description}</Text>
      {item.rejectionReason !== null && (
        <View style={styles.rejection}>
          <Text style={styles.rejectionTitle}>{REASON_LABELS[item.rejectionReason]}</Text>
          {item.rejectionNote !== null && <Text style={styles.rejectionNote}>{item.rejectionNote}</Text>}
        </View>
      )}
      {item.status === 'precheck_failed' && (
        <Text style={styles.help}>Automated checks could not complete. This snapshot was not published.</Text>
      )}
      {item.communityPatternId !== null && <Text style={styles.success}>Published to the Community Catalog.</Text>}
      {canAppeal && appealId !== item.id && (
        <Button title="Appeal Decision" variant="secondary" onPress={onOpenAppeal} />
      )}
      {appealId === item.id && (
        <View style={styles.appealForm}>
          <Text style={styles.help}>You can appeal this unchanged snapshot once.</Text>
          <TextInput
            accessibilityLabel="Appeal note"
            maxLength={1000}
            multiline
            onChangeText={onAppealNoteChange}
            placeholder="Optional context for the reviewing moderator"
            placeholderTextColor={Theme.colors.textSecondary}
            style={styles.input}
            textAlignVertical="top"
            value={appealNote}
          />
          {error !== null && <Text style={styles.error}>{error}</Text>}
          <View style={styles.actions}>
            <Button title="Cancel" variant="secondary" onPress={onCancelAppeal} style={styles.action} />
            <Button title="Submit Appeal" variant="rose" loading={submitting} onPress={onSubmitAppeal} style={styles.action} />
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
  titleRow: { alignItems: 'flex-start', flexDirection: 'row', gap: Theme.spacing.sm },
  title: { color: Theme.colors.textPrimary, flex: 1, fontSize: Theme.typography.sizes.md, fontWeight: Theme.typography.weights.bold },
  badge: { backgroundColor: Theme.colors.accentHoneySoft, borderRadius: Theme.radii.full, paddingHorizontal: Theme.spacing.sm, paddingVertical: Theme.spacing.xs },
  badgeText: { color: Theme.colors.textPrimary, fontSize: Theme.typography.sizes.xs, fontWeight: Theme.typography.weights.semibold },
  meta: { color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.xs },
  description: { color: Theme.colors.textPrimary, fontSize: Theme.typography.sizes.sm, lineHeight: 20 },
  rejection: { backgroundColor: Theme.colors.accentHoneySoft, borderRadius: Theme.radii.md, gap: Theme.spacing.xs, padding: Theme.spacing.md },
  rejectionTitle: { color: Theme.colors.error, fontSize: Theme.typography.sizes.sm, fontWeight: Theme.typography.weights.bold },
  rejectionNote: { color: Theme.colors.textPrimary, fontSize: Theme.typography.sizes.sm, lineHeight: 20 },
  success: { color: Theme.colors.success, fontSize: Theme.typography.sizes.sm, fontWeight: Theme.typography.weights.semibold },
  help: { color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.sm, lineHeight: 20 },
  appealForm: { gap: Theme.spacing.md },
  input: { backgroundColor: Theme.colors.background, borderColor: Theme.colors.border, borderRadius: Theme.radii.md, borderWidth: 1, color: Theme.colors.textPrimary, minHeight: 100, padding: Theme.spacing.md },
  actions: { flexDirection: 'row', gap: Theme.spacing.sm },
  action: { flex: 1 },
  error: { color: Theme.colors.error, fontSize: Theme.typography.sizes.sm },
});
