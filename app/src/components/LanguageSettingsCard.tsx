import React, { useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';

import { Card } from './Card';
import { Theme } from '../theme/theme';
import {
  SUPPORTED_LOCALE_CATALOG,
  SUPPORTED_LOCALES,
  getLanguageOverride,
  setActiveLanguageOverride,
  clearActiveLanguageOverride,
  getLocaleSelfName,
  getLocaleEnglishName,
  getLocaleFlag,
  getDeviceLanguages,
  resolveAppLanguage,
  type SupportedLocale,
} from '../i18n';

export function LanguageSettingsCard() {
  const { t, i18n: i18nInstance } = useTranslation('settings');
  const [modalVisible, setModalVisible] = useState(false);
  const [languageOverride, setLanguageOverrideState] = useState<string | null>(null);

  useEffect(() => {
    getLanguageOverride()
      .then(setLanguageOverrideState)
      .catch(() => setLanguageOverrideState(null));
  }, [i18nInstance.language]);

  const deviceLangs = getDeviceLanguages();
  const resolvedDeviceLocale = resolveAppLanguage(
    deviceLangs,
    null,
    SUPPORTED_LOCALES,
  ) as SupportedLocale;
  const detectedDeviceLanguageName = getLocaleSelfName(resolvedDeviceLocale);
  const detectedDeviceFlag = getLocaleFlag(resolvedDeviceLocale);

  const activeLocale = (languageOverride ?? resolvedDeviceLocale) as SupportedLocale;
  const activeSelfName = getLocaleSelfName(activeLocale);
  const activeFlag = getLocaleFlag(activeLocale);

  const triggerHaptic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const handleSelectLanguage = async (locale: SupportedLocale) => {
    triggerHaptic();
    setLanguageOverrideState(locale);
    try {
      await setActiveLanguageOverride(locale);
    } catch (err) {
      console.error('Failed to save language override:', err);
    }
    setTimeout(() => {
      setModalVisible(false);
    }, 150);
  };

  const handleFollowDeviceLanguage = async () => {
    triggerHaptic();
    setLanguageOverrideState(null);
    try {
      await clearActiveLanguageOverride();
    } catch (err) {
      console.error('Failed to clear language override:', err);
    }
    setTimeout(() => {
      setModalVisible(false);
    }, 150);
  };

  const isFollowingDevice = languageOverride === null;

  return (
    <>
      <Text style={styles.sectionTitle}>{t('language.sectionTitle')}</Text>
      <Card style={styles.triggerCard}>
        <Pressable
          accessibilityHint={t('language.modalSubtitle')}
          accessibilityLabel={t('language.sectionTitle')}
          accessibilityRole="button"
          onPress={() => setModalVisible(true)}
          style={({ pressed }) => [styles.triggerRow, pressed && styles.pressed]}
          testID="language-settings-trigger"
        >
          <View style={styles.leftContainer}>
            <View style={styles.iconCircle}>
              <Ionicons name="globe-outline" size={20} color={Theme.colors.accentTeal} />
            </View>
            <View style={styles.textContainer}>
              <Text style={styles.triggerTitle}>{t('language.sectionTitle')}</Text>
              <Text style={styles.triggerSubtitle} numberOfLines={1}>
                {isFollowingDevice
                  ? `${detectedDeviceFlag} ${t('language.systemDefault')} (${detectedDeviceLanguageName})`
                  : `${activeFlag} ${activeSelfName}`}
              </Text>
            </View>
          </View>

          <View style={styles.rightContainer}>
            <View style={styles.activeFlagBadge}>
              <Text style={styles.activeFlagText}>{activeFlag}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Theme.colors.textSecondary} />
          </View>
        </Pressable>
      </Card>

      <Modal
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
        statusBarTranslucent
        transparent
        visible={modalVisible}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            accessibilityLabel={t('actions.cancel')}
            accessibilityRole="button"
            onPress={() => setModalVisible(false)}
            style={styles.backdropDismiss}
          />
          <View style={styles.sheetContent}>
            {/* Sheet Handle */}
            <View style={styles.handleContainer}>
              <View style={styles.dragHandle} />
            </View>

            {/* Header */}
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderTitles}>
                <Text style={styles.sheetTitle}>{t('language.modalTitle')}</Text>
                <Text style={styles.sheetSubtitle}>{t('language.modalSubtitle')}</Text>
              </View>
              <Pressable
                accessibilityLabel={t('actions.cancel')}
                accessibilityRole="button"
                hitSlop={12}
                onPress={() => setModalVisible(false)}
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
                testID="language-modal-close"
              >
                <Ionicons name="close" size={20} color={Theme.colors.textSecondary} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.scrollList}
              showsVerticalScrollIndicator={false}
            >
              {/* System Default Option */}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: isFollowingDevice }}
                onPress={() => void handleFollowDeviceLanguage()}
                style={({ pressed }) => [
                  styles.optionRow,
                  isFollowingDevice && styles.optionRowActive,
                  pressed && styles.pressed,
                ]}
                testID="language-option-device"
              >
                <View style={styles.badgeCircleSystem}>
                  <Ionicons
                    name="phone-portrait-outline"
                    size={18}
                    color={Theme.colors.accentTeal}
                  />
                </View>
                <View style={styles.optionTextContainer}>
                  <Text style={[styles.optionSelfName, isFollowingDevice && styles.optionTextActive]}>
                    {t('language.systemDefault')}
                  </Text>
                  <Text style={styles.optionEnglishName}>
                    {t('language.systemDefaultDescription')} · {detectedDeviceLanguageName}
                  </Text>
                </View>
                {isFollowingDevice && (
                  <Ionicons
                    name="checkmark-circle"
                    size={22}
                    color={Theme.colors.accentTeal}
                    style={styles.checkIcon}
                  />
                )}
              </Pressable>

              <View style={styles.divider} />

              {/* Supported Locales Catalog */}
              {SUPPORTED_LOCALE_CATALOG.map(({ identifier, selfName, englishName, flag }) => {
                const isSelected = languageOverride === identifier;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    key={identifier}
                    onPress={() => void handleSelectLanguage(identifier)}
                    style={({ pressed }) => [
                      styles.optionRow,
                      isSelected && styles.optionRowActive,
                      pressed && styles.pressed,
                    ]}
                    testID={`language-option-${identifier}`}
                  >
                    <View style={styles.badgeCircleFlag}>
                      <Text style={styles.flagEmoji}>{flag}</Text>
                    </View>
                    <View style={styles.optionTextContainer}>
                      <Text
                        style={[
                          styles.optionSelfName,
                          isSelected && styles.optionTextActive,
                        ]}
                      >
                        {selfName}
                      </Text>
                      <Text style={styles.optionEnglishName}>{englishName}</Text>
                    </View>
                    {isSelected && (
                      <Ionicons
                        name="checkmark-circle"
                        size={22}
                        color={Theme.colors.accentTeal}
                        style={styles.checkIcon}
                      />
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  activeFlagBadge: {
    alignItems: 'center',
    backgroundColor: '#FAF6F0',
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.full,
    borderWidth: 1,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  activeFlagText: {
    fontSize: 14,
  },
  backdropDismiss: {
    flex: 1,
  },
  badgeCircleFlag: {
    alignItems: 'center',
    backgroundColor: '#FAF6F0',
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.full,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  badgeCircleSystem: {
    alignItems: 'center',
    backgroundColor: '#EEF6F6',
    borderColor: '#D2E7E8',
    borderRadius: Theme.radii.full,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  checkIcon: {
    marginStart: Theme.spacing.sm,
  },
  closeButton: {
    alignItems: 'center',
    backgroundColor: '#FAF6F0',
    borderRadius: Theme.radii.full,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  divider: {
    backgroundColor: Theme.colors.border,
    height: 1,
    marginHorizontal: Theme.spacing.lg,
    marginVertical: Theme.spacing.xs,
    opacity: 0.7,
  },
  dragHandle: {
    backgroundColor: Theme.colors.disabledText,
    borderRadius: Theme.radii.full,
    height: 4,
    opacity: 0.4,
    width: 36,
  },
  flagEmoji: {
    fontSize: 18,
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
  },
  iconCircle: {
    alignItems: 'center',
    backgroundColor: '#EEF6F6',
    borderRadius: Theme.radii.md,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  leftContainer: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: Theme.spacing.md,
    paddingEnd: Theme.spacing.sm,
  },
  modalBackdrop: {
    backgroundColor: 'rgba(23, 52, 56, 0.4)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  optionEnglishName: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.xs,
    marginTop: 2,
  },
  optionRow: {
    alignItems: 'center',
    borderRadius: Theme.radii.md,
    flexDirection: 'row',
    marginHorizontal: Theme.spacing.md,
    marginVertical: 2,
    paddingHorizontal: Theme.spacing.md,
    paddingVertical: Theme.spacing.md,
  },
  optionRowActive: {
    backgroundColor: '#FAF5EC',
    borderColor: '#E8DCB8',
    borderWidth: 1,
  },
  optionSelfName: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.semibold,
  },
  optionTextActive: {
    color: Theme.colors.accentTeal,
    fontWeight: Theme.typography.weights.bold,
  },
  optionTextContainer: {
    flex: 1,
    marginStart: Theme.spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
  rightContainer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Theme.spacing.sm,
  },
  scrollList: {
    paddingBottom: Platform.OS === 'ios' ? Theme.spacing.xxl : Theme.spacing.xl,
    paddingTop: Theme.spacing.xs,
  },
  sectionTitle: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.bold,
    letterSpacing: 1.0,
    marginBottom: Theme.spacing.sm,
    marginTop: Theme.spacing.lg,
    paddingLeft: Theme.spacing.xs,
    textTransform: 'uppercase',
  },
  sheetContent: {
    backgroundColor: Theme.colors.card,
    borderTopLeftRadius: Theme.radii.xl,
    borderTopRightRadius: Theme.radii.xl,
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  sheetHeader: {
    alignItems: 'center',
    borderBottomColor: Theme.colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: Theme.spacing.md,
    paddingHorizontal: Theme.spacing.lg,
  },
  sheetHeaderTitles: {
    flex: 1,
    gap: 2,
    paddingEnd: Theme.spacing.md,
  },
  sheetSubtitle: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.xs,
  },
  sheetTitle: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.lg,
    fontWeight: Theme.typography.weights.bold,
  },
  textContainer: {
    flex: 1,
    gap: 2,
  },
  triggerCard: {
    overflow: 'hidden',
    padding: 0,
  },
  triggerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: Theme.spacing.lg,
  },
  triggerSubtitle: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.medium,
    marginTop: 2,
  },
  triggerTitle: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.bold,
  },
});
