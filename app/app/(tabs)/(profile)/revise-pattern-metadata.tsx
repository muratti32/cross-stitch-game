import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { useCatalogCategories, useCatalogTags } from '@/api/catalog';
import { useCreateCatalogMetadataRevision, useMyPublishedPatterns } from '@/api/catalogMetadataRevisions';
import { Button, Card, EmptyState, Screen } from '@/components';
import { useIdentityStore } from '@/identity/guestIdentity';
import { Theme } from '@/theme/theme';

export default function RevisePatternMetadataScreen() {
  const params = useLocalSearchParams<{ patternId?: string | string[] }>();
  const patternId = Array.isArray(params.patternId) ? params.patternId[0] : params.patternId;
  const accountId = useIdentityStore((state) => state.accountId);
  const isAccount = useIdentityStore((state) => state.isAccount);
  const patternsQuery = useMyPublishedPatterns(accountId, isAccount);
  const categoriesQuery = useCatalogCategories();
  const tagsQuery = useCatalogTags();
  const mutation = useCreateCatalogMetadataRevision(accountId);
  const pattern = patternsQuery.data?.find((item) => item.id === patternId) ?? null;
  const initialized = React.useRef(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryCode, setCategoryCode] = useState('');
  const [tagCodes, setTagCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pattern === null || initialized.current) return;
    initialized.current = true;
    setTitle(pattern.title);
    setDescription(pattern.description ?? '');
    setCategoryCode(pattern.categoryCode);
    setTagCodes(pattern.tagCodes);
  }, [pattern]);

  const categories = categoriesQuery.data?.data ?? [];
  const tags = tagsQuery.data?.data ?? [];
  const normalizedTitle = title.trim().replace(/\s+/g, ' ');
  const normalizedDescription = description.trim().replace(/\s+/g, ' ');
  const canSubmit =
    pattern !== null &&
    pattern.canSubmitRevision &&
    normalizedTitle.length >= 1 &&
    normalizedTitle.length <= 120 &&
    normalizedDescription.length >= 1 &&
    normalizedDescription.length <= 2000 &&
    categoryCode.length > 0 &&
    !mutation.isPending;
  const loadingReferences = categoriesQuery.isPending || tagsQuery.isPending;
  const selectedTags = useMemo(() => new Set(tagCodes), [tagCodes]);

  const toggleTag = (code: string) => {
    setTagCodes((current) =>
      current.includes(code)
        ? current.filter((item) => item !== code)
        : current.length < 5
          ? [...current, code]
          : current,
    );
  };

  const submit = async () => {
    if (!canSubmit || patternId === undefined) return;
    setError(null);
    try {
      await mutation.mutateAsync({
        input: {
          categoryCode,
          description: normalizedDescription,
          sourceLanguage: 'en',
          tagCodes,
          title: normalizedTitle,
        },
        patternId,
      });
      router.replace('/(tabs)/(profile)/published-patterns');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <Screen scrollable contentContainerStyle={styles.container}>
      <Header title="Revise Metadata" />

      {!isAccount ? (
        <EmptyState
          icon="person-circle-outline"
          title="Registered Account Required"
          body="Sign in before revising a Community Pattern's metadata."
          actionLabel="Sign In"
          onAction={() => router.push('/(tabs)/(settings)/sign-in')}
          actionVariant="rose"
        />
      ) : patternsQuery.isPending ? (
        <ActivityIndicator style={styles.loader} color={Theme.colors.accentRose} />
      ) : pattern === null ? (
        <EmptyState
          icon="alert-circle-outline"
          title="Community Pattern Not Found"
          body="Only your own published Community Patterns can be revised."
          actionLabel="Back to Published Patterns"
          onAction={() => router.back()}
          actionVariant="sage"
        />
      ) : !pattern.canSubmitRevision ? (
        <EmptyState
          icon="hourglass-outline"
          title="Revision Already In Progress"
          body="This Pattern already has a pending revision or active appeal. Withdraw it before submitting another."
          actionLabel="Back to Published Patterns"
          onAction={() => router.back()}
          actionVariant="sage"
        />
      ) : (
        <View style={styles.form}>
          <Card style={styles.patternSummary}>
            <View style={styles.summaryText}>
              <Text style={styles.patternTitle} numberOfLines={2}>{pattern.title}</Text>
              <Text style={styles.helpText}>Currently published on the Community Catalog</Text>
            </View>
          </Card>

          <Field label="Catalog title" count={`${normalizedTitle.length}/120`}>
            <TextInput
              accessibilityLabel="Catalog title"
              maxLength={120}
              onChangeText={setTitle}
              placeholder="Pattern title"
              placeholderTextColor={Theme.colors.textSecondary}
              style={styles.input}
              value={title}
            />
          </Field>

          <Field label="Description" count={`${normalizedDescription.length}/2000`}>
            <TextInput
              accessibilityLabel="Catalog description"
              maxLength={2000}
              multiline
              onChangeText={setDescription}
              placeholder="Describe the design, subject, and stitching experience."
              placeholderTextColor={Theme.colors.textSecondary}
              style={[styles.input, styles.textarea]}
              textAlignVertical="top"
              value={description}
            />
          </Field>

          <Field label="Source language">
            <View style={styles.readonlyField}>
              <Text style={styles.readonlyText}>English</Text>
              <Ionicons name="lock-closed-outline" size={16} color={Theme.colors.textSecondary} />
            </View>
          </Field>

          <Field label="Category">
            {loadingReferences ? <ActivityIndicator color={Theme.colors.accentRose} /> : (
              <View style={styles.chips}>
                {categories.map((category) => (
                  <Chip
                    key={category.code}
                    label={category.label}
                    selected={category.code === categoryCode}
                    onPress={() => setCategoryCode(category.code)}
                  />
                ))}
              </View>
            )}
          </Field>

          <Field label="Tags" count={`${tagCodes.length}/5`}>
            {loadingReferences ? <ActivityIndicator color={Theme.colors.accentRose} /> : (
              <View style={styles.chips}>
                {tags.map((tag) => (
                  <Chip
                    key={tag.code}
                    label={tag.label}
                    selected={selectedTags.has(tag.code)}
                    disabled={!selectedTags.has(tag.code) && tagCodes.length >= 5}
                    onPress={() => toggleTag(tag.code)}
                  />
                ))}
              </View>
            )}
          </Field>

          <Text style={styles.notice}>
            Revising captures a new immutable snapshot. Your currently published metadata stays visible until a
            human moderator accepts this revision.
          </Text>
          {error !== null && <Text style={styles.error}>{error}</Text>}
          <Button
            title="Submit Revision"
            variant="rose"
            disabled={!canSubmit}
            loading={mutation.isPending}
            onPress={() => void submit()}
          />
        </View>
      )}
    </Screen>
  );
}

function Header({ title }: { title: string }) {
  return (
    <View style={styles.header}>
      <Pressable accessibilityLabel="Go back" hitSlop={12} onPress={() => router.back()}>
        <Ionicons name="chevron-back" size={26} color={Theme.colors.textPrimary} />
      </Pressable>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.headerSpacer} />
    </View>
  );
}

function Field({ children, count, label }: { children: React.ReactNode; count?: string; label: string }) {
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {count !== undefined && <Text style={styles.count}>{count}</Text>}
      </View>
      {children}
    </View>
  );
}

function Chip({ disabled, label, onPress, selected }: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected, disabled && styles.chipDisabled]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: Theme.spacing.lg, paddingBottom: Theme.spacing.xxl },
  header: { alignItems: 'center', flexDirection: 'row', marginBottom: Theme.spacing.xl },
  headerTitle: { color: Theme.colors.textPrimary, flex: 1, fontSize: Theme.typography.sizes.xl, fontWeight: Theme.typography.weights.bold, textAlign: 'center' },
  headerSpacer: { width: 26 },
  loader: { marginTop: Theme.spacing.xxl },
  form: { gap: Theme.spacing.xl },
  patternSummary: { flexDirection: 'row', gap: Theme.spacing.md },
  summaryText: { flex: 1, gap: Theme.spacing.xs },
  patternTitle: { color: Theme.colors.textPrimary, fontSize: Theme.typography.sizes.md, fontWeight: Theme.typography.weights.bold },
  helpText: { color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.sm },
  field: { gap: Theme.spacing.sm },
  labelRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  label: { color: Theme.colors.textPrimary, fontSize: Theme.typography.sizes.sm, fontWeight: Theme.typography.weights.semibold },
  count: { color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.xs },
  input: { backgroundColor: Theme.colors.card, borderColor: Theme.colors.border, borderRadius: Theme.radii.md, borderWidth: 1, color: Theme.colors.textPrimary, fontSize: Theme.typography.sizes.md, minHeight: 48, paddingHorizontal: Theme.spacing.md, paddingVertical: Theme.spacing.sm },
  textarea: { minHeight: 120 },
  readonlyField: { alignItems: 'center', backgroundColor: Theme.colors.disabledBackground, borderRadius: Theme.radii.md, flexDirection: 'row', justifyContent: 'space-between', minHeight: 48, paddingHorizontal: Theme.spacing.md },
  readonlyText: { color: Theme.colors.textPrimary, fontSize: Theme.typography.sizes.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Theme.spacing.sm },
  chip: { backgroundColor: Theme.colors.card, borderColor: Theme.colors.border, borderRadius: Theme.radii.full, borderWidth: 1, paddingHorizontal: Theme.spacing.md, paddingVertical: Theme.spacing.sm },
  chipSelected: { backgroundColor: Theme.colors.accentTeal, borderColor: Theme.colors.accentTeal },
  chipDisabled: { opacity: 0.45 },
  chipText: { color: Theme.colors.textPrimary, fontSize: Theme.typography.sizes.sm },
  chipTextSelected: { color: Theme.colors.textLight, fontWeight: Theme.typography.weights.semibold },
  notice: { color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.sm, lineHeight: 20 },
  error: { color: Theme.colors.error, fontSize: Theme.typography.sizes.sm },
});
