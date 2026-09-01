import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

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
import { Button, Card, Screen, StableRemoteImage } from '@/components';
import { listPersonalPatterns, resolveCreateErrorMessage, waitForConversion } from '@/conversion';
import { useIdentityStore } from '@/identity/guestIdentity';
import {
  preparePersonalSession,
  waitUntilSessionReady,
} from '@/session-preparation';
import { Theme } from '@/theme/theme';
import { formatNumber } from '@/i18n';

const ASPECT_OPTIONS: readonly ArtworkAspect[] = ['square', 'portrait_4_3', 'landscape_4_3'];

const ASPECT_BADGE_LABELS: Record<ArtworkAspect, string> = {
  square: '1:1',
  portrait_4_3: '3:4',
  landscape_4_3: '4:3',
};

function getStatusBadgeConfig(status: string) {
  switch (status) {
    case 'delivered':
      return {
        backgroundColor: '#EBF5EE',
        borderColor: '#B4DFBC',
        textColor: '#276738',
        iconName: 'checkmark-circle-outline' as const,
      };
    case 'pending':
    case 'dispatched':
    case 'running':
      return {
        backgroundColor: '#FFF8EB',
        borderColor: '#F1D7A4',
        textColor: '#8C5E1A',
        iconName: 'hourglass-outline' as const,
      };
    case 'safety_rejected':
    case 'failed':
      return {
        backgroundColor: '#FDF0F0',
        borderColor: '#F4BCBC',
        textColor: '#B3261E',
        iconName: 'alert-circle-outline' as const,
      };
    default:
      return {
        backgroundColor: '#F3F0EA',
        borderColor: '#E2DDD3',
        textColor: Theme.colors.textSecondary,
        iconName: 'help-circle-outline' as const,
      };
  }
}

export default function AiGenerationScreen() {
  const { t, i18n } = useTranslation('create');
  const router = useRouter();
  const isAccount = useIdentityStore((state) => state.isAccount);
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState<ArtworkAspect>('square');
  const [items, setItems] = useState<AiArtwork[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvalArtwork, setApprovalArtwork] = useState<AiArtwork | null>(null);
  const [approvalTitle, setApprovalTitle] = useState(() => t('aiGeneration.approve.defaultTitle'));
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [existingTitles, setExistingTitles] = useState<Set<string> | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const handleCopyPrompt = async (promptText: string, id: string) => {
    if (!promptText) return;
    await Clipboard.setStringAsync(promptText);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId((curr) => (curr === id ? null : curr));
    }, 2000);
  };

  const handleReusePrompt = (promptText: string, itemAspect?: ArtworkAspect) => {
    if (!promptText) return;
    setPrompt(promptText);
    if (itemAspect && ASPECT_OPTIONS.includes(itemAspect)) {
      setAspect(itemAspect);
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
    setTimeout(() => {
      inputRef.current?.focus();
    }, 150);
  };

  const toggleExpandPrompt = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleDeleteConfirm = (item: AiArtwork) => {
    Alert.alert(
      t('aiGeneration.library.deleteConfirmTitle'),
      t('aiGeneration.library.deleteConfirmBody'),
      [
        {
          text: t('aiGeneration.library.deleteConfirmCancel'),
          style: 'cancel',
        },
        {
          text: t('aiGeneration.library.deleteConfirmAction'),
          style: 'destructive',
          onPress: () => {
            deleteAiArtwork(item.id)
              .then(load)
              .catch((caught: unknown) => setError(resolveCreateErrorMessage(caught)));
          },
        },
      ],
    );
  };

  const load = useCallback(() => {
    if (!isAccount) return;
    listAiArtworks()
      .then((artworks) => {
        setItems(artworks);
        artworks.forEach(captureAiArtworkTerminalOutcome);
      })
      .catch((caught: unknown) =>
        setError(resolveCreateErrorMessage(caught, 'create:aiGeneration.library.errors.loadFailed')),
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
      const promptRejected = isPromptSafetyRejection(caught);
      await captureGameplayEvent(
        promptRejected ? 'ai_generation_prompt_blocked' : 'ai_generation_failed',
        promptRejected ? {} : { failure_stage: 'provider_submission' },
      );
      setError(
        promptRejected
          ? t('aiGeneration.generate.errors.promptRejected')
          : resolveCreateErrorMessage(caught, 'create:aiGeneration.generate.errors.generic'),
      );
    } finally {
      setBusy(false);
    }
  };

  const openApproval = (item: AiArtwork) => {
    const initialTitle = t('aiGeneration.approve.defaultTitle');
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
            ? suggestAiPatternTitle(patterns.map((pattern) => pattern.title), initialTitle)
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
      setApprovalError(resolveCreateErrorMessage(caught, 'create:aiGeneration.approve.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  if (!isAccount) {
    return (
      <Screen style={styles.center}>
        <Text style={styles.title}>{t('aiGeneration.gate.title')}</Text>
        <Text style={styles.body}>
          {t('aiGeneration.gate.body')}
        </Text>
        <Button
          title={t('aiGeneration.gate.signIn')}
          onPress={() => router.push('/(tabs)/(settings)/sign-in')}
        />
      </Screen>
    );
  }

  return (
    <>
      <Screen ref={scrollRef} scrollable contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={t('aiGeneration.header.backAccessibilityLabel')}
          >
            <Ionicons
              name="arrow-back"
              size={24}
              color={Theme.colors.accentTeal}
            />
          </Pressable>
          <Text style={styles.title}>{t('aiGeneration.header.title')}</Text>
        </View>
        <Card style={styles.card}>
          <Text style={styles.label}>{t('aiGeneration.prompt.label')}</Text>
          <TextInput
            ref={inputRef}
            value={prompt}
            onChangeText={setPrompt}
            multiline
            style={styles.input}
            placeholder={t('aiGeneration.prompt.placeholder')}
          />
          <View style={styles.aspects}>
            {ASPECT_OPTIONS.map((value) => (
              <Pressable
                key={value}
                style={[styles.aspect, aspect === value && styles.selected]}
                onPress={() => setAspect(value)}
              >
                <Text>{t(`aspects.${value}`)}</Text>
              </Pressable>
            ))}
          </View>
          <Button
            title={busy ? t('aiGeneration.generate.working') : t('aiGeneration.generate.action')}
            onPress={generate}
            disabled={busy || !prompt.trim()}
          />
        </Card>
        {error && <Text style={styles.error}>{error}</Text>}
        <Text style={styles.library}>{t('aiGeneration.library.title')}</Text>
        {items.map((item) => {
          const badgeConfig = getStatusBadgeConfig(item.status);
          const isCopied = copiedId === item.id;
          const isExpanded = expandedIds.has(item.id);
          const aspectBadge = ASPECT_BADGE_LABELS[item.aspect] ?? '1:1';

          return (
            <Card key={item.id} style={styles.itemCard}>
              <View style={styles.imageWrapper}>
                {item.imageUrl ? (
                  <StableRemoteImage uri={item.imageUrl} style={styles.image} />
                ) : (
                  <View style={styles.placeholder}>
                    <ActivityIndicator size="small" color={Theme.colors.accentTeal} />
                  </View>
                )}
                <View style={styles.aspectBadge}>
                  <Text style={styles.aspectBadgeText}>{aspectBadge}</Text>
                </View>
              </View>

              <View style={styles.itemBody}>
                <View style={styles.itemHeaderRow}>
                  <View
                    style={[
                      styles.statusBadge,
                      {
                        backgroundColor: badgeConfig.backgroundColor,
                        borderColor: badgeConfig.borderColor,
                      },
                    ]}
                  >
                    <Ionicons
                      name={badgeConfig.iconName}
                      size={13}
                      color={badgeConfig.textColor}
                    />
                    <Text style={[styles.statusText, { color: badgeConfig.textColor }]}>
                      {t(`aiGeneration.library.status.${item.status}`, {
                        defaultValue: t('aiGeneration.library.status.unknown'),
                      })}
                    </Text>
                  </View>

                  <Pressable
                    onPress={() => handleDeleteConfirm(item)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t('aiGeneration.library.deleteAccessibilityLabel')}
                    style={styles.deleteIconButton}
                  >
                    <Ionicons name="trash-outline" size={17} color={Theme.colors.accentRose} />
                  </Pressable>
                </View>

                {Boolean(item.prompt) && (
                  <View style={styles.promptContainer}>
                    <Pressable
                      onPress={() => toggleExpandPrompt(item.id)}
                      style={styles.promptTextBox}
                      accessibilityRole="button"
                    >
                      <Text
                        numberOfLines={isExpanded ? undefined : 2}
                        style={styles.promptText}
                      >
                        "{item.prompt}"
                      </Text>
                    </Pressable>

                    <View style={styles.promptActions}>
                      <Pressable
                        onPress={() => handleCopyPrompt(item.prompt, item.id)}
                        hitSlop={6}
                        style={styles.promptActionButton}
                        accessibilityRole="button"
                        accessibilityLabel={
                          isCopied
                            ? t('aiGeneration.library.copiedPrompt')
                            : t('aiGeneration.library.copyPrompt')
                        }
                      >
                        <Ionicons
                          name={isCopied ? 'checkmark-circle' : 'copy-outline'}
                          size={15}
                          color={isCopied ? Theme.colors.success : Theme.colors.textSecondary}
                        />
                      </Pressable>

                      <Pressable
                        onPress={() => handleReusePrompt(item.prompt, item.aspect)}
                        hitSlop={6}
                        style={styles.promptActionButton}
                        accessibilityRole="button"
                        accessibilityLabel={t('aiGeneration.library.reusePrompt')}
                      >
                        <Ionicons
                          name="arrow-up-circle-outline"
                          size={16}
                          color={Theme.colors.accentTeal}
                        />
                      </Pressable>
                    </View>
                  </View>
                )}

                {(item.status === 'failed' || item.status === 'safety_rejected') && (
                  <Text style={styles.failureReason}>
                    {t(`aiGeneration.library.failure.${item.status}`)}
                  </Text>
                )}
                {item.failureReason && item.supportReference && (
                  <Text selectable style={styles.supportReference}>
                    {t('errors:generic.supportReferenceLabel', { reference: item.supportReference })}
                  </Text>
                )}
                {item.status === 'delivered' && (
                  <Button
                    title={t('aiGeneration.library.approve')}
                    onPress={() => openApproval(item)}
                    disabled={busy}
                    style={styles.approveButton}
                  />
                )}
              </View>
            </Card>
          );
        })}
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
              <Text style={styles.modalTitle}>{t('aiGeneration.approve.modalTitle')}</Text>
              {approvalArtwork?.imageUrl && (
                <StableRemoteImage
                  uri={approvalArtwork.imageUrl}
                  style={styles.modalImage}
                />
              )}
              <Text style={styles.label}>{t('aiGeneration.approve.titleLabel')}</Text>
              <TextInput
                accessibilityLabel={t('aiGeneration.approve.titleAccessibilityLabel')}
                editable={!busy}
                maxLength={120}
                onChangeText={(value) => {
                  setApprovalTitle(value);
                  setApprovalError(null);
                }}
                placeholder={t('aiGeneration.approve.placeholder')}
                style={styles.titleInput}
                value={approvalTitle}
              />
              <Text style={styles.characterCount}>
                {t('aiGeneration.approve.characterCount', {
                  count: formatNumber(approvalTitle.length, i18n.language),
                  max: formatNumber(120, i18n.language),
                })}
              </Text>
              {duplicateTitle && (
                <Text style={styles.error}>
                  {t('common.duplicateTitle', { title: approvalTitle.trim() })}
                </Text>
              )}
              {approvalError && (
                <Text style={styles.error}>{approvalError}</Text>
              )}
              <View style={styles.modalActions}>
                <Button
                  title={t('aiGeneration.approve.cancel')}
                  onPress={closeApproval}
                  disabled={busy}
                  variant="secondary"
                  style={styles.modalButton}
                />
                <Button
                  title={busy ? t('aiGeneration.approve.creating') : t('aiGeneration.approve.create')}
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
  library: {
    fontSize: Theme.typography.sizes.lg,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
    marginTop: Theme.spacing.md,
  },
  itemCard: {
    flexDirection: 'row',
    gap: Theme.spacing.md,
    padding: Theme.spacing.md,
    alignItems: 'flex-start',
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.lg,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  imageWrapper: {
    width: 100,
    height: 100,
    borderRadius: Theme.radii.md,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: Theme.colors.patternImageBackdrop,
  },
  image: { width: 100, height: 100, borderRadius: Theme.radii.md },
  placeholder: {
    width: 100,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3EAD9',
  },
  aspectBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    backgroundColor: 'rgba(46, 42, 37, 0.75)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Theme.radii.sm,
  },
  aspectBadgeText: {
    color: '#FAF6F0',
    fontSize: 10,
    fontWeight: Theme.typography.weights.bold,
  },
  itemBody: { flex: 1, gap: 6 },
  itemHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Theme.radii.full,
    borderWidth: 1,
  },
  statusText: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.semibold,
  },
  deleteIconButton: {
    padding: 4,
    borderRadius: Theme.radii.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  promptContainer: {
    flexDirection: 'row',
    backgroundColor: '#F8F4ED',
    borderWidth: 1,
    borderColor: '#E8DEC9',
    borderRadius: Theme.radii.sm,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 6,
    alignItems: 'center',
    marginVertical: 2,
  },
  promptTextBox: { flex: 1 },
  promptText: {
    fontSize: 12,
    lineHeight: 16,
    color: Theme.colors.textPrimary,
    fontStyle: 'italic',
  },
  promptActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 6,
    borderLeftWidth: 1,
    borderLeftColor: '#E2D6C0',
  },
  promptActionButton: {
    padding: 2,
    borderRadius: 4,
  },
  approveButton: {
    height: 40,
    borderRadius: Theme.radii.md,
    marginTop: 4,
  },
  failureReason: { color: Theme.colors.error, fontSize: Theme.typography.sizes.xs },
  supportReference: { fontFamily: 'monospace', color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.xs },
  error: { color: Theme.colors.error },
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
