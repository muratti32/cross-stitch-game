import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';

import { Button, Card, Screen } from '@/components';
import { useTabBarSpace } from '@/theme/tabBar';
import {
  computeCropRectangle,
  createPhotoConversion,
  downscaledDimensions,
  listPersonalPatterns,
  PROFILE_OPTIONS,
  resolveCreateErrorMessage,
  resolveSettings,
  type ConversionProfile,
  waitForConversion,
} from '@/conversion';
import { useIdentityStore } from '@/identity/guestIdentity';
import { formatNumber } from '@/i18n';
import {
  preparePersonalSession,
  waitUntilSessionReady,
} from '@/session-preparation';
import { Theme } from '@/theme/theme';
import { captureGameplayEvent } from '@/analytics/gameplayEvents';
import type { ConversionFailureStage } from '@/analytics/schema';
import { withProtectedRoundTrip } from '@/navigation/foregroundEntryNavigation';

const PROFILE_LABEL_KEYS: Record<Exclude<ConversionProfile, 'custom'>, string> = {
  easy: 'photoImport.profile.options.easy',
  standard: 'photoImport.profile.options.standard',
  detailed: 'photoImport.profile.options.detailed',
};

const MAX_FRAME_HEIGHT = 300;
const MAX_ZOOM = 8;
const LOG_ASPECT_LIMIT = Math.log2(6);

/** The exact final frame no longer fits the selected Conversion Profile - a local, translated failure, not a server error. */
class ProfileMisfitError extends Error {}

export default function PhotoImportScreen() {
  const { t, i18n: i18nInstance } = useTranslation('create');
  const locale = i18nInstance.language;
  const router = useRouter();
  const tabBarSpace = useTabBarSpace();
  const { width: windowWidth } = useWindowDimensions();
  const isAccount = useIdentityStore((state) => state.isAccount);
  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [logAspect, setLogAspect] = useState(0);
  const [profile, setProfile] = useState<ConversionProfile>('easy');
  const [customShortEdge, setCustomShortEdge] = useState(80);
  const [customColors, setCustomColors] = useState(20);
  const [title, setTitle] = useState(() => t('photoImport.titleCard.defaultTitle'));
  const [busy, setBusy] = useState(false);
  const [pickingPhoto, setPickingPhoto] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [existingTitles, setExistingTitles] = useState<Set<string> | null>(null);
  const pickerLockRef = useRef(false);

  const interactionLocked = busy || pickingPhoto;

  const zoom = useSharedValue(1);
  const zoomAtStart = useSharedValue(1);
  const offsetX = useSharedValue(0);
  const offsetY = useSharedValue(0);

  const aspect = 2 ** logAspect;
  const maxFrameWidth = windowWidth;
  const frameSize = useMemo(() => {
    if (aspect >= 1) {
      return { width: maxFrameWidth, height: maxFrameWidth / aspect };
    }
    return { width: MAX_FRAME_HEIGHT * aspect, height: MAX_FRAME_HEIGHT };
  }, [aspect, maxFrameWidth]);

  const baseScale = asset
    ? Math.max(frameSize.width / asset.width, frameSize.height / asset.height)
    : 1;
  const baseRenderedWidth = asset ? asset.width * baseScale : 1;
  const baseRenderedHeight = asset ? asset.height * baseScale : 1;

  const settings = resolveSettings({
    customMaxColors: customColors,
    customShortEdgeCells: customShortEdge,
    profile,
    sourceHeight: frameSize.height,
    sourceWidth: frameSize.width,
  });

  useEffect(() => {
    zoom.value = 1;
    zoomAtStart.value = 1;
    offsetX.value = 0;
    offsetY.value = 0;
  }, [asset?.uri, frameSize.height, frameSize.width]);

  useEffect(() => {
    if (settings === null && profile !== 'custom') {
      setProfile('easy');
    }
  }, [profile, settings]);

  // Known titles power the inline duplicate warning; the server enforces
  // uniqueness authoritatively, so a failed fetch just skips the early warning.
  useEffect(() => {
    if (!isAccount) {
      return;
    }
    let cancelled = false;
    listPersonalPatterns()
      .then((patterns) => {
        if (!cancelled) {
          setExistingTitles(new Set(patterns.map((pattern) => normalizeTitle(pattern.title))));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExistingTitles(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isAccount]);

  const duplicateTitle = existingTitles?.has(normalizeTitle(title)) ?? false;

  const panGesture = Gesture.Pan().enabled(!interactionLocked).onChange((event) => {
    const renderedWidth = baseRenderedWidth * zoom.value;
    const renderedHeight = baseRenderedHeight * zoom.value;
    const maxX = Math.max(0, (renderedWidth - frameSize.width) / 2);
    const maxY = Math.max(0, (renderedHeight - frameSize.height) / 2);
    offsetX.value = Math.max(-maxX, Math.min(maxX, offsetX.value + event.changeX));
    offsetY.value = Math.max(-maxY, Math.min(maxY, offsetY.value + event.changeY));
  });
  const pinchGesture = Gesture.Pinch()
    .enabled(!interactionLocked)
    .onBegin(() => {
      zoomAtStart.value = zoom.value;
    })
    .onUpdate((event) => {
      zoom.value = Math.max(1, Math.min(MAX_ZOOM, zoomAtStart.value * event.scale));
      const maxX = Math.max(
        0,
        (baseRenderedWidth * zoom.value - frameSize.width) / 2,
      );
      const maxY = Math.max(
        0,
        (baseRenderedHeight * zoom.value - frameSize.height) / 2,
      );
      offsetX.value = Math.max(-maxX, Math.min(maxX, offsetX.value));
      offsetY.value = Math.max(-maxY, Math.min(maxY, offsetY.value));
    });
  const framingGesture = Gesture.Simultaneous(panGesture, pinchGesture);

  // Animate transforms only: animating width/height/left/top on Fabric makes
  // iOS decode the bitmap at a stale tiny layout size, rendering it blurry.
  const imageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: offsetX.value },
      { translateY: offsetY.value },
      { scale: zoom.value },
    ],
  }));

  const pickPhoto = async () => {
    if (pickerLockRef.current || busy) {
      return;
    }

    pickerLockRef.current = true;
    setPickingPhoto(true);
    setError(null);
    try {
      const permission = await withProtectedRoundTrip('permission', () =>
        ImagePicker.requestMediaLibraryPermissionsAsync(),
      );
      if (!permission.granted) {
        setError(t('photoImport.picker.errors.permissionDenied'));
        return;
      }

      const result = await withProtectedRoundTrip('photo-picker', () =>
        ImagePicker.launchImageLibraryAsync({
          allowsEditing: false,
          exif: false,
          mediaTypes: ['images'],
          quality: 1,
        }),
      );
      if (!result.canceled) {
        const selected = result.assets[0];
        if (selected.width < 1 || selected.height < 1) {
          setError(t('photoImport.picker.errors.invalidDimensions'));
          return;
        }
        setAsset(selected);
      }
    } catch (caught: unknown) {
      setError(resolveCreateErrorMessage(caught, 'create:photoImport.picker.errors.generic'));
    } finally {
      pickerLockRef.current = false;
      setPickingPhoto(false);
    }
  };

  const approveArtwork = async () => {
    if (
      pickerLockRef.current
      || busy
      || !asset
      || !settings
      || title.trim().length === 0
      || duplicateTitle
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setProcessingStatus(t('photoImport.processing.preparingFrame'));
    let uploadUri: string | null = null;
    let failureStage: ConversionFailureStage = 'upload';
    let conversionStarted = false;
    let conversionCompleted = false;
    try {
      const crop = computeCropRectangle({
        frameHeight: frameSize.height,
        frameWidth: frameSize.width,
        offsetX: offsetX.value,
        offsetY: offsetY.value,
        sourceHeight: asset.height,
        sourceWidth: asset.width,
        zoom: zoom.value,
      });
      const derivativeSize = downscaledDimensions(crop.width, crop.height);
      const derivative = await manipulateAsync(
        asset.uri,
        [
          { crop },
          ...(derivativeSize.width !== crop.width || derivativeSize.height !== crop.height
            ? [{ resize: derivativeSize }]
            : []),
        ],
        { compress: 0.92, format: SaveFormat.JPEG },
      );
      uploadUri = derivative.uri;

      const exactSettings = resolveSettings({
        customMaxColors: customColors,
        customShortEdgeCells: customShortEdge,
        profile,
        sourceHeight: derivative.height,
        sourceWidth: derivative.width,
      });
      if (exactSettings === null) {
        throw new ProfileMisfitError();
      }

      setProcessingStatus(t('photoImport.processing.uploading'));
      conversionStarted = true;
      await captureGameplayEvent('pattern_conversion_started', {
        source_artwork_kind: 'photo_artwork',
        conversion_profile: profile,
      });
      const pendingConversion = await createPhotoConversion({
        maxColors: exactSettings.maxColors,
        profile,
        shortEdgeCells: exactSettings.shortEdgeCells,
        title: title.trim(),
        uploadUri,
      });
      await FileSystem.deleteAsync(uploadUri, { idempotent: true });
      uploadUri = null;

      failureStage = 'conversion_engine';
      const pattern = await waitForConversion(pendingConversion.id, (status) => {
        setProcessingStatus(
          status === 'pending' || status === 'dispatched'
            ? t('photoImport.processing.waitingForWorker')
            : t('photoImport.processing.buildingGrid'),
        );
      }, pendingConversion.supportReference);
      await captureGameplayEvent('pattern_conversion_completed', {
        source_artwork_kind: 'photo_artwork',
      });
      conversionCompleted = true;
      failureStage = 'delivery';
      setProcessingStatus(t('photoImport.processing.preparingSession'));
      const session = await preparePersonalSession(pattern.id, {
        height: pattern.height,
        previewUrl: pattern.previewUrl,
        thumbnailUrl: pattern.thumbnailUrls?.browsing ?? null,
        title: pattern.title,
        width: pattern.width,
      });
      const readySession = await waitUntilSessionReady(session.id);
      // Screen stays mounted in the create tab's stack after switching to the
      // play tab, so clear conversion state and pop back to the Creation Hub.
      setExistingTitles((previous) => {
        if (previous === null) {
          return null;
        }
        const next = new Set(previous);
        next.add(normalizeTitle(pattern.title));
        return next;
      });
      setProcessingStatus(null);
      setAsset(null);
      setTitle(t('photoImport.titleCard.defaultTitle'));
      setProfile('easy');
      setCustomShortEdge(80);
      setCustomColors(20);
      setLogAspect(0);
      router.dismissAll();
      router.replace({
        pathname: '/(tabs)/(play)/[sessionId]',
        params: { sessionId: readySession.id, returnTo: '/(tabs)/(create)' },
      });
    } catch (caught: unknown) {
      if (conversionStarted && !conversionCompleted) {
        await captureGameplayEvent('pattern_conversion_failed', {
          source_artwork_kind: 'photo_artwork',
          failure_stage: failureStage,
        });
      }
      setError(
        caught instanceof ProfileMisfitError
          ? t('photoImport.convert.errors.profileMisfit')
          : resolveCreateErrorMessage(caught, 'create:photoImport.convert.errors.generic'),
      );
      setProcessingStatus(null);
    } finally {
      if (uploadUri !== null) {
        await FileSystem.deleteAsync(uploadUri, { idempotent: true }).catch(() => undefined);
      }
      setBusy(false);
    }
  };

  if (!isAccount) {
    return (
      <Screen style={styles.gateScreen}>
        <Ionicons name="person-circle-outline" size={64} color={Theme.colors.accentRose} />
        <Text style={styles.gateTitle}>{t('photoImport.gate.title')}</Text>
        <Text style={styles.gateBody}>
          {t('photoImport.gate.body')}
        </Text>
        <Button
          title={t('photoImport.gate.signIn')}
          onPress={() => router.push('/(tabs)/(settings)/sign-in')}
          variant="rose"
        />
        <Button title={t('photoImport.gate.back')} onPress={() => router.back()} variant="secondary" />
      </Screen>
    );
  }

  return (
    <Screen style={styles.screen} clearsTabBar={false}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          disabled={interactionLocked}
          accessibilityRole="button"
          accessibilityLabel={t('photoImport.header.backAccessibilityLabel')}
        >
          <Ionicons name="arrow-back" size={24} color={Theme.colors.accentTeal} />
        </Pressable>
        <View>
          <Text style={styles.title}>{t('photoImport.header.title')}</Text>
          <Text style={styles.subtitle}>{t('photoImport.header.subtitle')}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarSpace }]} showsVerticalScrollIndicator={false}>
        {asset === null ? (
          <Card style={styles.pickerCard}>
            <Ionicons name="images-outline" size={52} color={Theme.colors.accentRose} />
            <Text style={styles.sectionTitle}>{t('photoImport.picker.chooseTitle')}</Text>
            <Text style={styles.helpText}>
              {t('photoImport.picker.helpText')}
            </Text>
            <Button
              title={t('photoImport.picker.choose')}
              onPress={pickPhoto}
              disabled={busy}
              loading={pickingPhoto}
              variant="rose"
            />
          </Card>
        ) : (
          <>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>{t('photoImport.framing.title')}</Text>
              <Pressable
                onPress={pickPhoto}
                disabled={interactionLocked}
                style={styles.pickerLink}
              >
                {pickingPhoto && (
                  <ActivityIndicator size="small" color={Theme.colors.accentTeal} />
                )}
                <Text style={styles.linkText}>
                  {pickingPhoto ? t('photoImport.picker.opening') : t('photoImport.picker.chooseAnother')}
                </Text>
              </Pressable>
            </View>
            <View style={styles.frameStage}>
              <GestureDetector gesture={framingGesture}>
                <View
                  style={[
                    styles.frame,
                    { height: frameSize.height, width: frameSize.width },
                  ]}
                >
                  <Animated.Image
                    source={{ uri: asset.uri }}
                    style={[
                      styles.framedImage,
                      {
                        height: baseRenderedHeight,
                        left: (frameSize.width - baseRenderedWidth) / 2,
                        top: (frameSize.height - baseRenderedHeight) / 2,
                        width: baseRenderedWidth,
                      },
                      imageStyle,
                    ]}
                  />
                  <View pointerEvents="none" style={styles.frameBorder} />
                </View>
              </GestureDetector>
            </View>
            <Text style={styles.gestureHint}>{t('photoImport.framing.gestureHint')}</Text>

            <Card style={styles.controlCard}>
              <View style={styles.labelRow}>
                <Text style={styles.controlLabel}>{t('photoImport.framing.aspectLabel')}</Text>
                <Text style={styles.controlValue}>{formatAspect(aspect, locale)}</Text>
              </View>
              <Slider
                minimumValue={-LOG_ASPECT_LIMIT}
                maximumValue={LOG_ASPECT_LIMIT}
                value={logAspect}
                onValueChange={setLogAspect}
                minimumTrackTintColor={Theme.colors.accentRose}
                maximumTrackTintColor={Theme.colors.border}
                thumbTintColor={Theme.colors.accentRose}
                disabled={interactionLocked}
              />
              <View style={styles.boundRow}>
                <Text style={styles.boundText}>1:6</Text>
                <Text style={styles.boundText}>1:1</Text>
                <Text style={styles.boundText}>6:1</Text>
              </View>
            </Card>

            <Text style={styles.sectionTitle}>{t('photoImport.profile.title')}</Text>
            <View style={styles.profileGrid}>
              {PROFILE_OPTIONS.map((option) => {
                const available = resolveSettings({
                  customMaxColors: customColors,
                  customShortEdgeCells: customShortEdge,
                  profile: option.id,
                  sourceHeight: frameSize.height,
                  sourceWidth: frameSize.width,
                }) !== null;
                return (
                  <Pressable
                    key={option.id}
                    disabled={!available || interactionLocked}
                    onPress={() => setProfile(option.id)}
                    style={[
                      styles.profileCard,
                      profile === option.id && styles.profileCardSelected,
                      !available && styles.profileCardDisabled,
                    ]}
                  >
                    <Text style={styles.profileTitle}>{t(PROFILE_LABEL_KEYS[option.id])}</Text>
                    <Text style={styles.profileMeta}>
                      {formatNumber(option.shortEdgeCells, locale)} {t('common.cellsCount', { count: option.shortEdgeCells })} · ≤{formatNumber(option.maxColors, locale)} {t('common.colorsCount', { count: option.maxColors })}
                    </Text>
                    {!available && <Text style={styles.unavailableText}>{t('photoImport.profile.unavailable')}</Text>}
                  </Pressable>
                );
              })}
              <Pressable
                disabled={interactionLocked}
                onPress={() => setProfile('custom')}
                style={[
                  styles.profileCard,
                  profile === 'custom' && styles.profileCardSelected,
                  profile === 'custom' && settings === null && styles.profileCardDisabled,
                ]}
              >
                <Text style={styles.profileTitle}>{t('photoImport.profile.custom')}</Text>
                <Text style={styles.profileMeta}>{t('photoImport.profile.customMeta')}</Text>
              </Pressable>
            </View>

            {profile === 'custom' && (
              <Card style={styles.controlCard}>
                <View style={styles.labelRow}>
                  <Text style={styles.controlLabel}>{t('photoImport.profile.customShortEdgeLabel')}</Text>
                  <Text style={styles.controlValue}>
                    {formatNumber(customShortEdge, locale)} {t('common.cellsCount', { count: customShortEdge })}
                  </Text>
                </View>
                <Slider
                  minimumValue={20}
                  maximumValue={300}
                  step={1}
                  value={customShortEdge}
                  onValueChange={setCustomShortEdge}
                  minimumTrackTintColor={Theme.colors.accentTeal}
                  thumbTintColor={Theme.colors.accentTeal}
                  disabled={interactionLocked}
                />
                <View style={styles.labelRow}>
                  <Text style={styles.controlLabel}>{t('photoImport.profile.customColorLimitLabel')}</Text>
                  <Text style={styles.controlValue}>{formatNumber(customColors, locale)}</Text>
                </View>
                <Slider
                  minimumValue={5}
                  maximumValue={60}
                  step={1}
                  value={customColors}
                  onValueChange={setCustomColors}
                  minimumTrackTintColor={Theme.colors.accentTeal}
                  thumbTintColor={Theme.colors.accentTeal}
                  disabled={interactionLocked}
                />
              </Card>
            )}

            <Card style={styles.approvalCard}>
              <Text style={styles.controlLabel}>{t('photoImport.titleCard.label')}</Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                maxLength={255}
                editable={!interactionLocked}
                style={styles.titleInput}
                placeholder={t('photoImport.titleCard.placeholder')}
                placeholderTextColor={Theme.colors.textSecondary}
              />
              {duplicateTitle && (
                <Text style={styles.errorText}>
                  {t('common.duplicateTitle', { title: title.trim() })}
                </Text>
              )}
              {settings ? (
                <Text style={styles.summaryText}>
                  {t('photoImport.titleCard.summary', {
                    width: formatNumber(settings.width, locale),
                    height: formatNumber(settings.height, locale),
                    maxColors: formatNumber(settings.maxColors, locale),
                    cellsUnit: t('common.cellsCount', { count: settings.height }),
                    colorsUnit: t('common.colorsCount', { count: settings.maxColors }),
                  })}
                </Text>
              ) : (
                <Text style={styles.errorText}>
                  {t('photoImport.profile.exceedsLimit', { max: formatNumber(300, locale) })}
                </Text>
              )}
              <View style={styles.privacyRow}>
                <Ionicons name="shield-checkmark-outline" size={18} color={Theme.colors.accentSage} />
                <Text style={styles.privacyText}>
                  {t('photoImport.titleCard.privacyNotice')}
                </Text>
              </View>
              <Button
                title={t('photoImport.titleCard.approve')}
                onPress={approveArtwork}
                disabled={interactionLocked || settings === null || title.trim().length === 0 || duplicateTitle}
                loading={busy}
                variant="rose"
              />
            </Card>
          </>
        )}

        {processingStatus && (
          <View style={styles.statusRow}>
            <ActivityIndicator color={Theme.colors.accentTeal} />
            <Text style={styles.statusText}>{processingStatus}</Text>
          </View>
        )}
        {error && <Text style={styles.errorText}>{error}</Text>}
      </ScrollView>
    </Screen>
  );
}

function formatAspect(aspect: number, locale: string): string {
  const options: Intl.NumberFormatOptions = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return aspect >= 1
    ? `${formatNumber(aspect, locale, options)}:1`
    : `1:${formatNumber(1 / aspect, locale, options)}`;
}

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase();
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: Theme.spacing.lg },
  gateScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Theme.spacing.xl,
    gap: Theme.spacing.md,
  },
  gateTitle: { fontSize: Theme.typography.sizes.xl, fontWeight: Theme.typography.weights.bold, color: Theme.colors.textPrimary, textAlign: 'center' },
  gateBody: { fontSize: Theme.typography.sizes.sm, color: Theme.colors.textSecondary, textAlign: 'center', lineHeight: 21, marginBottom: Theme.spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Theme.spacing.lg, marginBottom: Theme.spacing.md, gap: Theme.spacing.md },
  backButton: { padding: Theme.spacing.xs },
  title: { fontSize: Theme.typography.sizes.xl, fontWeight: Theme.typography.weights.bold, color: Theme.colors.textPrimary },
  subtitle: { fontSize: Theme.typography.sizes.xs, color: Theme.colors.textSecondary, marginTop: 2 },
  content: { paddingHorizontal: Theme.spacing.lg, paddingBottom: Theme.spacing.xxl, gap: Theme.spacing.md },
  pickerCard: { minHeight: 360, alignItems: 'center', justifyContent: 'center', padding: Theme.spacing.xl, gap: Theme.spacing.md },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { fontSize: Theme.typography.sizes.md, fontWeight: Theme.typography.weights.bold, color: Theme.colors.textPrimary },
  helpText: { fontSize: Theme.typography.sizes.sm, color: Theme.colors.textSecondary, lineHeight: 20, textAlign: 'center' },
  linkText: { color: Theme.colors.accentTeal, fontSize: Theme.typography.sizes.sm, fontWeight: Theme.typography.weights.semibold },
  pickerLink: { flexDirection: 'row', alignItems: 'center', gap: Theme.spacing.xs },
  frameStage: {
    minHeight: MAX_FRAME_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEE8DF',
    borderRadius: 0,
    marginHorizontal: -Theme.spacing.lg,
    overflow: 'hidden',
  },
  frame: { overflow: 'hidden', backgroundColor: '#D9D1C6' },
  framedImage: { position: 'absolute' },
  frameBorder: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderColor: '#FFFFFF', borderWidth: 2 },
  gestureHint: { textAlign: 'center', color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.xs },
  controlCard: { padding: Theme.spacing.md, gap: Theme.spacing.xs },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  controlLabel: { fontSize: Theme.typography.sizes.sm, fontWeight: Theme.typography.weights.semibold, color: Theme.colors.textPrimary },
  controlValue: { fontSize: Theme.typography.sizes.sm, color: Theme.colors.accentTeal, fontWeight: Theme.typography.weights.semibold },
  boundRow: { flexDirection: 'row', justifyContent: 'space-between' },
  boundText: { fontSize: Theme.typography.sizes.xs, color: Theme.colors.textSecondary },
  profileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Theme.spacing.sm },
  profileCard: { width: '48%', minHeight: 78, borderWidth: 1, borderColor: Theme.colors.border, borderRadius: Theme.radii.md, padding: Theme.spacing.md, backgroundColor: Theme.colors.card },
  profileCardSelected: { borderColor: Theme.colors.accentRose, backgroundColor: '#FBECEE' },
  profileCardDisabled: { opacity: 0.45 },
  profileTitle: { fontSize: Theme.typography.sizes.sm, fontWeight: Theme.typography.weights.bold, color: Theme.colors.textPrimary },
  profileMeta: { fontSize: Theme.typography.sizes.xs, color: Theme.colors.textSecondary, marginTop: Theme.spacing.xs },
  unavailableText: { fontSize: 10, color: Theme.colors.error, marginTop: 3 },
  approvalCard: { padding: Theme.spacing.md, gap: Theme.spacing.md },
  titleInput: { height: 46, borderWidth: 1, borderColor: Theme.colors.border, borderRadius: Theme.radii.sm, paddingHorizontal: Theme.spacing.md, color: Theme.colors.textPrimary, backgroundColor: '#FFFFFF' },
  summaryText: { fontSize: Theme.typography.sizes.sm, color: Theme.colors.textSecondary },
  privacyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Theme.spacing.sm },
  privacyText: { flex: 1, fontSize: Theme.typography.sizes.xs, color: Theme.colors.textSecondary, lineHeight: 17 },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Theme.spacing.sm, padding: Theme.spacing.md },
  statusText: { flex: 1, fontSize: Theme.typography.sizes.sm, color: Theme.colors.textSecondary },
  errorText: { color: Theme.colors.error, fontSize: Theme.typography.sizes.sm, lineHeight: 19 },
});
