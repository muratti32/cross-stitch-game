import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  AiCreditShortfallError,
  approveAiArtwork,
  captureAiArtworkTerminalOutcome,
  deleteAiArtwork,
  generateAiArtwork,
  isPromptSafetyRejection,
  listAiArtworks,
  normalizePersonalPatternTitle,
  suggestAiPatternTitle,
  type AiArtwork,
  type ArtworkAspect,
} from '@/ai-artwork';
import { captureGameplayEvent } from '@/analytics/gameplayEvents';
import { Button, Card, Screen } from '@/components';
import { listPersonalPatterns, waitForConversion } from '@/conversion';
import { useIdentityStore } from '@/identity/guestIdentity';
import {
  preparePersonalSession,
  waitUntilSessionReady,
} from '@/session-preparation';
import { Theme } from '@/theme/theme';

const aspects: Array<[ArtworkAspect, string]> = [
  ['square', 'Square'],
  ['portrait_4_3', 'Portrait 4:3'],
  ['landscape_4_3', 'Landscape 4:3'],
];

export default function AiGenerationScreen() {
  const router = useRouter();
  const isAccount = useIdentityStore((state) => state.isAccount);
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState<ArtworkAspect>('square');
  const [items, setItems] = useState<AiArtwork[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvalArtwork, setApprovalArtwork] = useState<AiArtwork | null>(null);
  const [approvalTitle, setApprovalTitle] = useState('My AI Pattern');
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [existingTitles, setExistingTitles] = useState<Set<string> | null>(null);

  const load = useCallback(() => {
    if (!isAccount) return;
    listAiArtworks()
      .then((artworks) => {
        setItems(artworks);
        artworks.forEach(captureAiArtworkTerminalOutcome);
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : String(caught)),
      );
  }, [isAccount]);

  useFocusEffect(
    useCallback(() => {
      load();
      const timer = setInterval(load, 4000);
      return () => clearInterval(timer);
    }, [load]),
  );

  const generate = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    await captureGameplayEvent('ai_generation_started', { aspect });
    try {
      await generateAiArtwork(prompt.trim(), aspect);
      setPrompt('');
      load();
    } catch (caught: unknown) {
      if (caught instanceof AiCreditShortfallError) {
        router.push({
          pathname: '/(tabs)/(profile)/commerce',
          params: {
            category: 'ai_credit',
            source: 'ai_credit_shortfall',
          },
        });
        return;
      }
      await captureGameplayEvent(
        isPromptSafetyRejection(caught)
          ? 'ai_generation_prompt_blocked'
          : 'ai_generation_failed',
        isPromptSafetyRejection(caught)
          ? {}
          : { failure_stage: 'provider_submission' },
      );
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const openApproval = (item: AiArtwork) => {
    const initialTitle = 'My AI Pattern';
    setApprovalArtwork(item);
    setApprovalTitle(initialTitle);
    setApprovalError(null);
    setExistingTitles(null);

    listPersonalPatterns()
      .then((patterns) => {
        const titles = new Set(
          patterns.map((pattern) => normalizePersonalPatternTitle(pattern.title)),
        );
        setExistingTitles(titles);
        setApprovalTitle((currentTitle) =>
          currentTitle === initialTitle
            ? suggestAiPatternTitle(patterns.map((pattern) => pattern.title))
            : currentTitle,
        );
      })
      .catch(() => {
        // The backend remains authoritative if the early duplicate check cannot load.
        setExistingTitles(null);
      });
  };

  const closeApproval = () => {
    if (busy) return;
    setApprovalArtwork(null);
    setApprovalError(null);
  };

  const normalizedApprovalTitle = normalizePersonalPatternTitle(approvalTitle);
  const duplicateTitle =
    existingTitles?.has(normalizedApprovalTitle) ?? false;
  const canApprove = normalizedApprovalTitle.length > 0 && !duplicateTitle;

  const approve = async () => {
    if (!approvalArtwork || !canApprove || busy) return;
    setBusy(true);
    setApprovalError(null);
    let conversionCompleted = false;
    await captureGameplayEvent('pattern_conversion_started', {
      source_artwork_kind: 'ai_artwork',
      conversion_profile: 'easy',
    });
    try {
      const job = await approveAiArtwork(
        approvalArtwork.id,
        approvalTitle.trim(),
      );
      const pattern = await waitForConversion(
        job.id,
        undefined,
        job.supportReference,
      );
      await captureGameplayEvent('pattern_conversion_completed', {
        source_artwork_kind: 'ai_artwork',
      });
      conversionCompleted = true;
      const session = await preparePersonalSession(pattern.id, {
        ...pattern,
        thumbnailUrl: pattern.thumbnailUrls?.browsing ?? null,
      });
      const ready = await waitUntilSessionReady(session.id);
      router.dismissAll();
      router.replace({
        pathname: '/(tabs)/(play)/[sessionId]',
        params: {
          sessionId: ready.id,
          returnTo: '/(tabs)/(create)',
        },
      });
    } catch (caught: unknown) {
      if (!conversionCompleted) {
        await captureGameplayEvent('pattern_conversion_failed', {
          source_artwork_kind: 'ai_artwork',
          failure_stage: 'conversion_engine',
        });
      }
      setApprovalError(
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setBusy(false);
    }
  };

  if (!isAccount) {
    return (
      <Screen style={styles.center}>
        <Text style={styles.title}>Registered Account Required</Text>
        <Text style={styles.body}>
          AI artwork and its library stay private to your account.
        </Text>
        <Button
          title="Sign in"
          onPress={() => router.push('/(tabs)/(settings)/sign-in')}
        />
      </Screen>
    );
  }

  return (
    <>
      <Screen scrollable contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()}>
            <Ionicons
              name="arrow-back"
              size={24}
              color={Theme.colors.accentTeal}
            />
          </Pressable>
          <Text style={styles.title}>AI Generator</Text>
        </View>
        <Card style={styles.card}>
          <Text style={styles.label}>Describe your artwork</Text>
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            multiline
            style={styles.input}
            placeholder="A cozy cottage garden at sunset…"
          />
          <View style={styles.aspects}>
            {aspects.map(([value, label]) => (
              <Pressable
                key={value}
                style={[styles.aspect, aspect === value && styles.selected]}
                onPress={() => setAspect(value)}
              >
                <Text>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Button
            title={busy ? 'Working…' : 'Generate — 1 AI Credit'}
            onPress={generate}
            disabled={busy || !prompt.trim()}
          />
        </Card>
        {error && <Text style={styles.error}>{error}</Text>}
        <Text style={styles.library}>Your AI Artwork Library</Text>
        {items.map((item) => (
          <Card key={item.id} style={styles.item}>
            {item.imageUrl ? (
              <Image source={{ uri: item.imageUrl }} style={styles.image} />
            ) : (
              <View style={styles.placeholder}>
                <ActivityIndicator />
              </View>
            )}
            <View style={styles.itemBody}>
              <Text style={styles.status}>{item.status.replace('_', ' ')}</Text>
              {item.failureReason && (
                <Text style={styles.error}>{item.failureReason}</Text>
              )}
              {item.failureReason && item.supportReference && (
                <Text selectable style={styles.supportReference}>
                  Support Reference: {item.supportReference}
                </Text>
              )}
              {item.status === 'delivered' && (
                <Button
                  title="Approve into Pattern"
                  onPress={() => openApproval(item)}
                  disabled={busy}
                />
              )}
              <Pressable onPress={() => deleteAiArtwork(item.id).then(load)}>
                <Text style={styles.delete}>Delete</Text>
              </Pressable>
            </View>
          </Card>
        ))}
      </Screen>

      <Modal
        animationType="fade"
        onRequestClose={closeApproval}
        transparent
        visible={approvalArtwork !== null}
      >
        <View style={styles.modalOverlay}>
          <View accessibilityViewIsModal style={styles.modalContainer}>
            <Card style={styles.modalCard}>
              <Text style={styles.modalTitle}>Create Personal Pattern</Text>
              {approvalArtwork?.imageUrl && (
                <Image
                  source={{ uri: approvalArtwork.imageUrl }}
                  style={styles.modalImage}
                />
              )}
              <Text style={styles.label}>Pattern title</Text>
              <TextInput
                accessibilityLabel="Pattern title"
                editable={!busy}
                maxLength={120}
                onChangeText={(value) => {
                  setApprovalTitle(value);
                  setApprovalError(null);
                }}
                placeholder="My AI Pattern"
                style={styles.titleInput}
                value={approvalTitle}
              />
              <Text style={styles.characterCount}>
                {approvalTitle.length}/120
              </Text>
              {duplicateTitle && (
                <Text style={styles.error}>
                  You already have a Personal Pattern named “
                  {approvalTitle.trim()}”. Choose a different title.
                </Text>
              )}
              {approvalError && (
                <Text style={styles.error}>{approvalError}</Text>
              )}
              <View style={styles.modalActions}>
                <Button
                  title="Cancel"
                  onPress={closeApproval}
                  disabled={busy}
                  variant="secondary"
                  style={styles.modalButton}
                />
                <Button
                  title={busy ? 'Creating Pattern…' : 'Create Pattern'}
                  onPress={approve}
                  disabled={busy || !canApprove}
                  loading={busy}
                  variant="rose"
                  style={styles.modalButton}
                />
              </View>
            </Card>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { padding: Theme.spacing.lg, gap: Theme.spacing.md },
  center: {
    padding: Theme.spacing.xl,
    justifyContent: 'center',
    gap: Theme.spacing.md,
  },
  header: { flexDirection: 'row', gap: Theme.spacing.md, alignItems: 'center' },
  title: {
    fontSize: Theme.typography.sizes.xl,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  body: { color: Theme.colors.textSecondary },
  card: { gap: Theme.spacing.md },
  label: { fontWeight: Theme.typography.weights.semibold },
  input: {
    minHeight: 90,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: Theme.radii.sm,
    padding: Theme.spacing.sm,
    textAlignVertical: 'top',
  },
  aspects: { flexDirection: 'row', flexWrap: 'wrap', gap: Theme.spacing.xs },
  aspect: { padding: Theme.spacing.sm, borderWidth: 1, borderColor: '#ddd', borderRadius: Theme.radii.sm },
  selected: { borderColor: Theme.colors.accentTeal, backgroundColor: '#e8f6f4' },
  library: { fontSize: Theme.typography.sizes.md, fontWeight: Theme.typography.weights.bold, marginTop: Theme.spacing.md },
  item: { flexDirection: 'row', gap: Theme.spacing.md },
  image: { width: 100, height: 100, borderRadius: Theme.radii.sm },
  placeholder: { width: 100, height: 100, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f1f1f1' },
  itemBody: { flex: 1, gap: Theme.spacing.sm },
  status: { textTransform: 'capitalize', fontWeight: Theme.typography.weights.semibold },
  supportReference: { fontFamily: 'monospace', color: Theme.colors.textSecondary },
  delete: { color: Theme.colors.accentRose, fontWeight: Theme.typography.weights.semibold },
  error: { color: '#a22' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Theme.spacing.lg,
  },
  modalContainer: { width: '100%', maxWidth: 420 },
  modalCard: { gap: Theme.spacing.sm },
  modalTitle: {
    fontSize: Theme.typography.sizes.lg,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  modalImage: {
    width: '100%',
    aspectRatio: 1,
    maxHeight: 260,
    borderRadius: Theme.radii.sm,
    resizeMode: 'contain',
    backgroundColor: '#f1f1f1',
  },
  titleInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: Theme.radii.sm,
    paddingHorizontal: Theme.spacing.sm,
    minHeight: 48,
    color: Theme.colors.textPrimary,
  },
  characterCount: { alignSelf: 'flex-end', color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.sm },
  modalActions: { flexDirection: 'row', gap: Theme.spacing.sm, marginTop: Theme.spacing.sm },
  modalButton: { flex: 1 },
});
