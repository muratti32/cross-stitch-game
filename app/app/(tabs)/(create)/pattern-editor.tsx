import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  TextInput,
  ScrollView,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Screen, EmptyState, Card, Button } from '@/components';
import { Theme } from '@/theme/theme';
import { useTabBarSpace } from '@/theme/tabBar';
import { useIdentityStore } from '@/identity/guestIdentity';
import {
  getEditorDraft,
  saveEditorDraft,
  addPendingPersonalPattern,
  generateUUID,
  type PaletteEntry,
  type EditorDraftHistory,
} from '@/local-db';
import {
  listDmcColors,
  getPersonalPatternArtifactGrant,
  downloadPersonalPatternArtifact,
  createDerivedPattern,
  ApiError,
  type DmcColor,
} from '@/pattern-editor/api';
import { formatNumber } from '@/i18n';
import { listPersonalPatterns, resolveCreateErrorMessage } from '@/conversion';
import { base64ToUint8Array, uint8ArrayToBase64 } from '@/session-preparation';

import { EditorGrid } from '@/pattern-editor/EditorGrid';
import { DmcColorPicker } from '@/pattern-editor/DmcColorPicker';

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase();
}

export default function PatternEditorScreen() {
  const { t, i18n: i18nInstance } = useTranslation('create');
  const locale = i18nInstance.language;
  const router = useRouter();
  const tabBarSpace = useTabBarSpace();
  const { patternId } = useLocalSearchParams<{ patternId?: string }>();
  const isAccount = useIdentityStore((state) => state.isAccount);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [history, setHistory] = useState<EditorDraftHistory | null>(null);
  const [dmcColors, setDmcColors] = useState<DmcColor[]>([]);
  const [selectedColor, setSelectedColor] = useState<DmcColor | null>(null);

  // Replace mode state
  const [isReplaceMode, setIsReplaceMode] = useState(false);
  const [replaceSourceIndex, setReplaceSourceIndex] = useState<number | null>(null);

  // Title and Save state
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [existingTitles, setExistingTitles] = useState<Set<string> | null>(null);
  const [limitError, setLimitError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // 1. Load existing titles on mount for duplicate check early warning
  useEffect(() => {
    if (!isAccount) return;
    let cancelled = false;
    listPersonalPatterns()
      .then((patterns) => {
        if (!cancelled) {
          setExistingTitles(new Set(patterns.map((p) => normalizeTitle(p.title))));
        }
      })
      .catch(() => {
        if (!cancelled) setExistingTitles(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isAccount]);

  const duplicateTitle = existingTitles?.has(normalizeTitle(title)) ?? false;

  // 2. Load pattern artifact or resume draft on mount
  const loadPattern = useCallback(async () => {
    if (!patternId || !isAccount) return;
    setLoading(true);
    setError(null);
    try {
      const colors = await listDmcColors();
      setDmcColors(colors);

      const draft = await getEditorDraft(patternId);
      if (draft) {
        setWidth(draft.width);
        setHeight(draft.height);
        setHistory(draft.history);
      } else {
        const grant = await getPersonalPatternArtifactGrant(patternId);
        const patternData = await downloadPersonalPatternArtifact(grant);
        setWidth(patternData.width);
        setHeight(patternData.height);

        const initialHistory: EditorDraftHistory = {
          snapshots: [{
            gridBase64: uint8ArrayToBase64(patternData.grid),
            palette: patternData.palette,
          }],
          cursor: 0,
        };
        setHistory(initialHistory);
        await saveEditorDraft(patternId, patternData.width, patternData.height, initialHistory);
      }
    } catch (err) {
      setError(resolveCreateErrorMessage(err, 'create:patternEditor.load.errors.generic'));
    } finally {
      setLoading(false);
    }
  }, [patternId, isAccount]);

  useEffect(() => {
    loadPattern();
  }, [loadPattern]);

  // Derived state for current snapshot
  const currentSnapshot = useMemo(() => {
    if (!history) return null;
    return history.snapshots[history.cursor];
  }, [history]);

  const currentGrid = useMemo(() => {
    if (!currentSnapshot) return null;
    return base64ToUint8Array(currentSnapshot.gridBase64);
  }, [currentSnapshot]);

  const currentPalette = useMemo(() => {
    if (!currentSnapshot) return [];
    return currentSnapshot.palette;
  }, [currentSnapshot]);

  // Distinct colors in grid for replace mode
  const distinctColorsInGrid = useMemo(() => {
    if (!currentGrid || !currentPalette) return [];
    const usedIndices = new Set<number>();
    for (let i = 0; i < currentGrid.length; i++) {
      const val = currentGrid[i];
      if (val > 0) {
        usedIndices.add(val);
      }
    }
    const result: { paletteIndex: number; dmcCode: string; name: string; rgbHex: string }[] = [];
    usedIndices.forEach((idx) => {
      const entry = currentPalette[idx - 1];
      if (entry) {
        result.push({
          paletteIndex: idx,
          ...entry,
        });
      }
    });
    return result;
  }, [currentGrid, currentPalette]);

  // Apply edits to history
  const applyEdit = (newGrid: Uint8Array, newPalette: PaletteEntry[]) => {
    if (!history || !patternId) return;
    const truncated = history.snapshots.slice(0, history.cursor + 1);
    const nextSnapshots = [
      ...truncated,
      { gridBase64: uint8ArrayToBase64(newGrid), palette: newPalette },
    ];
    const MAX_HISTORY = 30;
    const capped = nextSnapshots.length > MAX_HISTORY
      ? nextSnapshots.slice(nextSnapshots.length - MAX_HISTORY)
      : nextSnapshots;
    const next = { snapshots: capped, cursor: capped.length - 1 };
    setHistory(next);
    void saveEditorDraft(patternId, width, height, next);
  };

  const handleUndo = () => {
    if (!history || !patternId || history.cursor <= 0) return;
    const next = { ...history, cursor: history.cursor - 1 };
    setHistory(next);
    void saveEditorDraft(patternId, width, height, next);
  };

  const handleRedo = () => {
    if (!history || !patternId || history.cursor >= history.snapshots.length - 1) return;
    const next = { ...history, cursor: history.cursor + 1 };
    setHistory(next);
    void saveEditorDraft(patternId, width, height, next);
  };

  // Returns the 1-based grid value for `color` within `palette`, appending a new
  // palette entry (deduped by dmcCode) if `color` is not already present. Grid
  // cell value 0 means empty, so palette indices are always paletteArrayIndex + 1.
  function resolvePaletteIndex(palette: PaletteEntry[], color: DmcColor): { index: number; palette: PaletteEntry[] } {
    const existing = palette.findIndex((p) => p.dmcCode === color.dmcCode);
    if (existing !== -1) {
      return { index: existing + 1, palette };
    }
    if (palette.length >= 255) {
      throw new Error(
        t('patternEditor.errors.paletteLimit', { max: formatNumber(255, locale) }),
      );
    }
    const nextPalette = [...palette, { dmcCode: color.dmcCode, name: color.name, rgbHex: color.rgbHex }];
    return { index: nextPalette.length, palette: nextPalette };
  }

  // Handle single-cell tap recolor
  const handleCellTap = (cellIndex: number) => {
    if (!currentGrid || !selectedColor) {
      setLimitError(t('patternEditor.errors.pickColorFirst'));
      return;
    }
    setLimitError(null);
    try {
      const { index, palette: nextPalette } = resolvePaletteIndex(currentPalette, selectedColor);
      const nextGrid = currentGrid.slice();
      nextGrid[cellIndex] = index;
      applyEdit(nextGrid, nextPalette);
    } catch {
      setLimitError(t('patternEditor.errors.paletteLimit', { max: formatNumber(255, locale) }));
    }
  };

  // Handle select catalog color (different behavior in replace mode vs paint mode)
  const handleSelectCatalogColor = (color: DmcColor) => {
    setLimitError(null);
    if (isReplaceMode) {
      if (replaceSourceIndex === null) {
        setSelectedColor(color);
        return;
      }
      try {
        const { index: targetIndex, palette: nextPalette } = resolvePaletteIndex(currentPalette, color);
        if (replaceSourceIndex === targetIndex) {
          return;
        }
        if (!currentGrid) return;
        const nextGrid = currentGrid.slice();
        for (let i = 0; i < nextGrid.length; i++) {
          if (nextGrid[i] === replaceSourceIndex) {
            nextGrid[i] = targetIndex;
          }
        }
        applyEdit(nextGrid, nextPalette);
        setReplaceSourceIndex(null);
      } catch {
        setLimitError(t('patternEditor.errors.paletteLimit', { max: formatNumber(255, locale) }));
      }
    } else {
      setSelectedColor(color);
    }
  };

  // Handle save as new pattern
  const handleSaveAsNew = async () => {
    if (!currentGrid || !patternId) return;
    setBusy(true);
    setSaveError(null);
    const newPatternId = generateUUID();
    const gridBase64 = uint8ArrayToBase64(currentGrid);
    const input = {
      patternId: newPatternId,
      sourcePatternId: patternId,
      title: title.trim(),
      width,
      height,
      palette: currentPalette,
      grid: gridBase64,
    };
    try {
      await createDerivedPattern(input);
      router.back();
    } catch (err: unknown) {
      if (err instanceof ApiError && (err.status === 409 || err.status === 400 || err.status === 403)) {
        setSaveError(
          err.status === 409
            ? t('common.duplicateTitle', { title: title.trim() })
            : resolveCreateErrorMessage(err, 'create:patternEditor.save.errors.generic'),
        );
        setBusy(false);
        return;
      }

      // ANY other failure (offline, network error, unexpected 5xx) falls back to
      // the offline outbox so Save as New always succeeds locally even without
      // connectivity; syncPendingPersonalPatterns() (wired at app launch/foreground
      // in app/app/_layout.tsx) will retry it and the derive endpoint is
      // idempotent on patternId, so this is always safe to enqueue.
      await addPendingPersonalPattern({
        patternId: newPatternId,
        sourcePatternId: patternId,
        title: title.trim(),
        width,
        height,
        palette: currentPalette,
        gridBase64,
        createdAt: new Date().toISOString(),
      });
      Alert.alert(
        t('patternEditor.save.offlineTitle'),
        t('patternEditor.save.offlineBody'),
      );
      router.back();
    } finally {
      setBusy(false);
    }
  };

  if (!patternId) {
    return (
      <Screen style={styles.gateScreen}>
        <Ionicons name="alert-circle-outline" size={64} color={Theme.colors.accentRose} />
        <Text style={styles.gateTitle}>{t('patternEditor.gate.noPatternTitle')}</Text>
        <Text style={styles.gateBody}>
          {t('patternEditor.gate.noPatternBody')}
        </Text>
        <Button title={t('patternEditor.gate.back')} onPress={() => router.back()} variant="secondary" />
      </Screen>
    );
  }

  if (!isAccount) {
    return (
      <Screen style={styles.gateScreen}>
        <Ionicons name="person-circle-outline" size={64} color={Theme.colors.accentRose} />
        <Text style={styles.gateTitle}>{t('patternEditor.gate.accountTitle')}</Text>
        <Text style={styles.gateBody}>
          {t('patternEditor.gate.accountBody')}
        </Text>
        <Button
          title={t('patternEditor.gate.signIn')}
          onPress={() => router.push('/(tabs)/(settings)/sign-in')}
          variant="rose"
        />
        <Button title={t('patternEditor.gate.back')} onPress={() => router.back()} variant="secondary" />
      </Screen>
    );
  }

  if (loading) {
    return (
      <Screen style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={Theme.colors.accentRose} />
        <Text style={styles.loadingText}>{t('patternEditor.loading')}</Text>
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen style={styles.gateScreen}>
        <Ionicons name="cloud-offline-outline" size={64} color={Theme.colors.accentRose} />
        <Text style={styles.gateTitle}>{t('patternEditor.load.failedTitle')}</Text>
        <Text style={styles.gateBody}>{error}</Text>
        <Button title={t('patternEditor.load.retry')} onPress={loadPattern} variant="rose" />
        <Button title={t('patternEditor.load.back')} onPress={() => router.back()} variant="secondary" />
      </Screen>
    );
  }

  return (
    <Screen style={styles.container}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={t('patternEditor.header.backAccessibilityLabel')}
        >
          <Ionicons name="arrow-back" size={24} color={Theme.colors.accentTeal} />
        </Pressable>
        <Text style={styles.title}>{t('patternEditor.header.title')}</Text>
        <Text style={styles.dimensions}>
          {t('patternEditor.header.dimensions', { width: formatNumber(width, locale), height: formatNumber(height, locale) })}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarSpace }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Editor Grid Area */}
        <View style={styles.gridContainer}>
          {currentGrid && (
            <EditorGrid
              width={width}
              height={height}
              palette={currentPalette}
              grid={currentGrid}
              onCellTap={handleCellTap}
            />
          )}
        </View>

        {/* Undo / Redo Toolbar */}
        <View style={styles.toolbar}>
          <Button
            title={t('patternEditor.toolbar.undo')}
            variant="secondary"
            disabled={!history || history.cursor === 0}
            onPress={handleUndo}
            style={styles.toolbarButton}
          />
          <Button
            title={t('patternEditor.toolbar.redo')}
            variant="secondary"
            disabled={!history || history.cursor === history.snapshots.length - 1}
            onPress={handleRedo}
            style={styles.toolbarButton}
          />
        </View>

        {/* Mode Toggle Control */}
        <Card style={styles.controlCard}>
          <View style={styles.modeToggleRow}>
            <Pressable
              onPress={() => {
                setIsReplaceMode(false);
                setReplaceSourceIndex(null);
                setLimitError(null);
              }}
              style={[
                styles.modeToggleButton,
                !isReplaceMode && styles.modeToggleButtonActive,
              ]}
            >
              <Text
                style={[
                  styles.modeToggleLabel,
                  !isReplaceMode && styles.modeToggleLabelActive,
                ]}
              >
                {t('patternEditor.mode.paint')}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setIsReplaceMode(true);
                setReplaceSourceIndex(null);
                setLimitError(null);
              }}
              style={[
                styles.modeToggleButton,
                isReplaceMode && styles.modeToggleButtonActive,
              ]}
            >
              <Text
                style={[
                  styles.modeToggleLabel,
                  isReplaceMode && styles.modeToggleLabelActive,
                ]}
              >
                {t('patternEditor.mode.replaceColor')}
              </Text>
            </Pressable>
          </View>

          {isReplaceMode ? (
            <View style={styles.replaceContainer}>
              <Text style={styles.hintText}>
                {t('patternEditor.mode.replaceStep1')}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.distinctScroll}>
                <View style={styles.distinctRow}>
                  {distinctColorsInGrid.map((color) => {
                    const isSourceSelected = replaceSourceIndex === color.paletteIndex;
                    return (
                      <Pressable
                        key={color.dmcCode}
                        onPress={() => {
                          setReplaceSourceIndex(color.paletteIndex);
                          setLimitError(null);
                        }}
                        style={[
                          styles.swatchWrapper,
                          isSourceSelected && styles.swatchWrapperSelected,
                        ]}
                      >
                        <View style={[styles.swatch, { backgroundColor: color.rgbHex }]} />
                        <Text style={styles.swatchLabel}>{color.dmcCode}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
              {replaceSourceIndex !== null && (
                <Text style={styles.hintText}>
                  {t('patternEditor.mode.replaceStep2')}
                </Text>
              )}
            </View>
          ) : (
            <View style={styles.paintContainer}>
              <Text style={styles.hintText}>
                {selectedColor
                  ? t('patternEditor.mode.paintSelected', { dmcCode: selectedColor.dmcCode, name: selectedColor.name })
                  : t('patternEditor.mode.paintUnselected')}
              </Text>
            </View>
          )}

          {limitError && <Text style={styles.errorText}>{limitError}</Text>}
        </Card>

        {/* Master DMC Catalog Picker */}
        <View style={styles.pickerSection}>
          <Text style={styles.sectionTitle}>{t('patternEditor.picker.title')}</Text>
          <DmcColorPicker
            colors={dmcColors}
            selectedDmcCode={selectedColor?.dmcCode ?? null}
            onSelect={handleSelectCatalogColor}
          />
        </View>

        {/* Save as New Section */}
        <Card style={styles.saveCard}>
          <Text style={styles.saveLabel}>{t('patternEditor.save.label')}</Text>
          <TextInput
            value={title}
            onChangeText={(val) => {
              setTitle(val);
              setSaveError(null);
            }}
            maxLength={255}
            editable={!busy}
            style={styles.titleInput}
            placeholder={t('patternEditor.save.placeholder')}
            placeholderTextColor={Theme.colors.textSecondary}
          />
          {duplicateTitle && (
            <Text style={styles.errorText}>
              {t('common.duplicateTitle', { title: title.trim() })}
            </Text>
          )}
          {saveError && <Text style={styles.errorText}>{saveError}</Text>}
          <Button
            title={t('patternEditor.save.action')}
            onPress={handleSaveAsNew}
            disabled={busy || title.trim().length === 0 || duplicateTitle}
            loading={busy}
            variant="rose"
            style={styles.saveButton}
          />
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: Theme.spacing.xl,
    paddingHorizontal: Theme.spacing.lg,
  },
  gateScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Theme.spacing.xl,
    gap: Theme.spacing.md,
  },
  gateTitle: {
    fontSize: Theme.typography.sizes.xl,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
    textAlign: 'center',
  },
  gateBody: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: Theme.spacing.md,
  },
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Theme.spacing.md,
  },
  loadingText: {
    fontSize: Theme.typography.sizes.md,
    color: Theme.colors.textSecondary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Theme.spacing.lg,
    gap: Theme.spacing.md,
  },
  backButton: {
    padding: Theme.spacing.xs,
  },
  title: {
    fontSize: Theme.typography.sizes.xl,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  dimensions: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
  },
  scrollContent: {
    gap: Theme.spacing.lg,
  },
  gridContainer: {
    height: 320,
    width: '100%',
    borderRadius: Theme.radii.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Theme.spacing.md,
  },
  toolbarButton: {
    flex: 1,
    height: 40,
  },
  controlCard: {
    padding: Theme.spacing.md,
    gap: Theme.spacing.sm,
  },
  modeToggleRow: {
    flexDirection: 'row',
    backgroundColor: Theme.colors.disabledBackground,
    borderRadius: Theme.radii.sm,
    padding: 2,
  },
  modeToggleButton: {
    flex: 1,
    paddingVertical: Theme.spacing.sm,
    alignItems: 'center',
    borderRadius: Theme.radii.sm,
  },
  modeToggleButtonActive: {
    backgroundColor: Theme.colors.card,
  },
  modeToggleLabel: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    fontWeight: Theme.typography.weights.medium,
  },
  modeToggleLabelActive: {
    color: Theme.colors.textPrimary,
    fontWeight: Theme.typography.weights.bold,
  },
  paintContainer: {
    paddingVertical: Theme.spacing.xs,
  },
  replaceContainer: {
    gap: Theme.spacing.xs,
  },
  hintText: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
  },
  distinctScroll: {
    marginVertical: Theme.spacing.xs,
  },
  distinctRow: {
    flexDirection: 'row',
    gap: Theme.spacing.sm,
    paddingBottom: Theme.spacing.xs,
  },
  swatchWrapper: {
    padding: 2,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: Theme.radii.sm + 2,
    alignItems: 'center',
    gap: 2,
  },
  swatchWrapperSelected: {
    borderColor: Theme.colors.accentRose,
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: Theme.radii.sm,
  },
  swatchLabel: {
    fontSize: 9,
    color: Theme.colors.textSecondary,
    fontWeight: Theme.typography.weights.medium,
  },
  errorText: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.error,
    marginTop: Theme.spacing.xs,
  },
  pickerSection: {
    gap: Theme.spacing.sm,
  },
  sectionTitle: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  saveCard: {
    padding: Theme.spacing.md,
    gap: Theme.spacing.sm,
  },
  saveLabel: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  titleInput: {
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.sm,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.sm,
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.sm,
    backgroundColor: Theme.colors.background,
  },
  saveButton: {
    marginTop: Theme.spacing.xs,
  },
});
