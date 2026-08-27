import React from 'react';
import { StyleSheet, View, Text, Switch, ActivityIndicator, Pressable, Alert, Linking, Modal, TextInput, Platform } from 'react-native';
import { Screen, Card, Button, AccountSection, ThemeCollectionCard } from '@/components';
import { router } from 'expo-router';
import { Theme } from '@/theme/theme';
import { useGameplayStore } from '@/store';
import { useHealthCheck } from '@/hooks/useHealthCheck';
import { Config, WebLinks } from '@/config';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { setHandedness as setHandednessDb } from '@/local-db';
import { useBackendSession } from '@/hooks/useBackendSession';
import { shortenGuestId } from '@/identity/identityLogic';
import { resetGuestData, removeLocalData, useIdentityStore, logout } from '@/identity/guestIdentity';
import { useAccountDeletionStatus, useRequestAccountDeletion, useCancelAccountDeletion, AccountDeletionApiError } from '@/api/accountDeletion';
import { withProtectedRoundTrip } from '@/navigation/foregroundEntryNavigation';
import { useMembership } from '@/api/membership';
import {
  getReauthenticationIdentities,
  reauthenticateWithEmail,
  reauthenticateWithFirebase,
  requestReauthenticationEmailCode,
  type ReauthenticationIdentity,
} from '@/api/accountReauthentication';
import { isServerApiError, localizeServerError } from '@/api/localizeServerError';
import { acquireAppleProviderIdToken, acquireGoogleProviderIdToken } from '@/identity/firebaseSso';
import { loadOnboardingState, resumeTutorial, saveOnboardingPosition } from '@/onboarding/state';
import { useTranslation } from 'react-i18next';
import {
  LANGUAGE_MIGRATION_GATE_OPEN,
  SUPPORTED_LOCALES,
  getLanguageOverride,
  setActiveLanguageOverride,
  clearActiveLanguageOverride,
  type SupportedLocale,
} from '@/i18n';

// App identity is read from the Expo config so the settings footer can never
// drift away from app.json / app.config.ts.
const expoConfig = Constants.expoConfig;
const appVersion = expoConfig?.version ?? 'unknown';
const sdkVersion = expoConfig?.sdkVersion?.split('.')[0];
const appIdentifier =
  Platform.OS === 'ios'
    ? expoConfig?.ios?.bundleIdentifier ?? 'unknown'
    : expoConfig?.android?.package ?? 'unknown';
const appScheme = Array.isArray(expoConfig?.scheme)
  ? expoConfig.scheme[0] ?? 'unknown'
  : expoConfig?.scheme ?? 'unknown';

export default function SettingsScreen() {
  const { t } = useTranslation('settings');
  const { showGridLines, toggleGridLines, handedness, setHandedness } = useGameplayStore();
  const { data: health, isLoading, error, refetch, isRefetching } = useHealthCheck();
  const { data: sessionData, isLoading: sessionLoading, error: sessionError } = useBackendSession();
  const isAccount = useIdentityStore((state) => state.isAccount);
  const { data: membership } = useMembership(isAccount);

  const {
    data: deletionStatus,
    isLoading: deletionLoading,
    error: deletionError,
    refetch: refetchDeletionStatus,
  } = useAccountDeletionStatus(isAccount);

  const { mutateAsync: requestDeletion } = useRequestAccountDeletion();
  const { mutateAsync: cancelDeletion } = useCancelAccountDeletion();

  const [resetModalVisible, setResetModalVisible] = React.useState(false);
  const [typedConfirmation, setTypedConfirmation] = React.useState('');
  const [isResetting, setIsResetting] = React.useState(false);
  const [isRemovingLocal, setIsRemovingLocal] = React.useState(false);

  const [deleteModalVisible, setDeleteModalVisible] = React.useState(false);
  const [deletionStage, setDeletionStage] = React.useState<1 | 2>(1);
  const [deleteConfirmation, setDeleteConfirmation] = React.useState('');
  const [isSubmittingDeletion, setIsSubmittingDeletion] = React.useState(false);
  const [isCancellingDeletion, setIsCancellingDeletion] = React.useState(false);
  const [reauthVisible, setReauthVisible] = React.useState(false);
  const [reauthIdentities, setReauthIdentities] = React.useState<ReauthenticationIdentity[]>([]);
  const [reauthLoading, setReauthLoading] = React.useState(false);
  const [reauthProvider, setReauthProvider] = React.useState<'apple' | 'google' | null>(null);
  const [reauthEmail, setReauthEmail] = React.useState<string | null>(null);
  const [reauthCode, setReauthCode] = React.useState('');
  const [reauthCodeSent, setReauthCodeSent] = React.useState(false);
  const [reauthError, setReauthError] = React.useState<string | null>(null);

  // #157's migration gate: the picker below only ever mounts while it is
  // open (see LANGUAGE_MIGRATION_GATE_OPEN), so this state is a no-op read
  // for every player until #167.
  const [languageOverride, setLanguageOverrideState] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!LANGUAGE_MIGRATION_GATE_OPEN) return;
    getLanguageOverride().then(setLanguageOverrideState).catch(() => setLanguageOverrideState(null));
  }, []);

  const isOffline = !isLoading && (!!error || !health || health.status !== 'ok');

  const formatRecoveryWindowEnd = (recoveryWindowEndsAt?: string): string => {
    if (!recoveryWindowEndsAt) {
      return t('common.unavailable');
    }

    const endDate = new Date(recoveryWindowEndsAt);
    return Number.isNaN(endDate.getTime())
      ? t('common.unavailable')
      : endDate.toLocaleDateString();
  };

  const handleResetGuestData = async () => {
    if (typedConfirmation !== 'RESET') {
      return;
    }
    setIsResetting(true);
    try {
      await resetGuestData();
      setResetModalVisible(false);
      setTypedConfirmation('');
      Alert.alert(t('resetModal.successTitle'), t('resetModal.successMessage'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      Alert.alert(t('resetModal.failedTitle'), t('resetModal.failedMessage', { message: msg }));
    } finally {
      setIsResetting(false);
    }
  };

  const handleRemoveLocalData = () => {
    Alert.alert(
      t('data.removeLocalConfirmTitle'),
      t('data.removeLocalConfirmMessage'),
      [
        { text: t('actions.cancel'), style: 'cancel' },
        {
          text: t('data.removeLocalConfirmAction'),
          style: 'destructive',
          onPress: async () => {
            setIsRemovingLocal(true);
            try {
              await removeLocalData();
              Alert.alert(t('data.removeLocalSuccessTitle'), t('data.removeLocalSuccessMessage'));
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : 'Unknown error';
              Alert.alert(t('data.removeLocalFailedTitle'), t('data.removeLocalFailedMessage', { message: msg }));
            } finally {
              setIsRemovingLocal(false);
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  const handleHandednessChange = async (value: 'left' | 'right') => {
    setHandedness(value);
    try {
      await setHandednessDb(value);
    } catch (err) {
      console.error('Failed to save handedness preference to database:', err);
    }
  };

  const handleSelectLanguage = async (locale: SupportedLocale) => {
    setLanguageOverrideState(locale);
    try {
      await setActiveLanguageOverride(locale);
    } catch (err) {
      console.error('Failed to save language override:', err);
    }
  };

  const handleFollowDeviceLanguage = async () => {
    setLanguageOverrideState(null);
    try {
      await clearActiveLanguageOverride();
    } catch (err) {
      console.error('Failed to clear language override:', err);
    }
  };

  const handleLearnControls = async () => {
    try {
      const onboarding = await loadOnboardingState();
      if (onboarding.position === 'deferred') {
        await saveOnboardingPosition('welcome');
        router.navigate('/onboarding/welcome');
        return;
      }
      if (onboarding.tutorialRunState === 'paused' && onboarding.tutorialSessionId) {
        await resumeTutorial(onboarding.tutorialSessionId);
        router.navigate({
          pathname: '/(tabs)/(play)/[sessionId]',
          params: { sessionId: onboarding.tutorialSessionId },
        });
      }
    } catch (error) {
      console.warn('Failed to resume tutorial:', error);
      Alert.alert(t('tutorial.unavailableTitle'), t('tutorial.unavailableMessage'));
    }
  };

  const handleLinkPress = (title: string, url: string) => {
    void withProtectedRoundTrip('external-link', () => Linking.openURL(url), {
      keepUntilForeground: true,
    }).catch(() => {
      Alert.alert(title, t('links.openFailedMessage', { url }));
    });
  };

  const handleSubscriptionManagePress = () => {
    const url = Platform.OS === 'ios'
      ? 'https://apps.apple.com/account/subscriptions'
      : 'https://play.google.com/store/account/subscriptions';
    void withProtectedRoundTrip('subscription-management', () => Linking.openURL(url), {
      keepUntilForeground: true,
    }).catch(() => {
      Alert.alert(t('links.openFailedGenericTitle'), t('links.openFailedMessage', { url }));
    });
  };

  const finishDeletionRequest = async () => {
    const result = await requestDeletion();
    setDeleteModalVisible(false);
    setReauthVisible(false);
    setDeleteConfirmation('');
    setDeletionStage(1);
    Alert.alert(
      t('accountDeletion.requestedTitle'),
      t('accountDeletion.requestedMessage', { date: formatRecoveryWindowEnd(result.recoveryWindowEndsAt) }),
    );
    void logout().catch(() => {
      Alert.alert(t('accountDeletion.signOutFailedTitle'), t('accountDeletion.signOutFailedMessage'));
    });
  };

  const openReauthentication = async () => {
    setDeleteModalVisible(false);
    setReauthVisible(true);
    setReauthLoading(true);
    setReauthError(null);
    setReauthCodeSent(false);
    setReauthCode('');
    try {
      setReauthIdentities(await getReauthenticationIdentities());
    } catch {
      setReauthIdentities([]);
      setReauthError(t('reauthModal.loadFailed'));
    } finally {
      setReauthLoading(false);
    }
  };

  const handleRequestDeletion = async () => {
    if (deleteConfirmation !== 'DELETE') return;
    setIsSubmittingDeletion(true);
    try {
      await finishDeletionRequest();
    } catch (error: unknown) {
      if (error instanceof AccountDeletionApiError && error.reauthenticationRequired) {
        await openReauthentication();
      } else {
        Alert.alert(t('accountDeletion.requestFailedTitle'), t('accountDeletion.requestFailedMessage'));
      }
    } finally {
      setIsSubmittingDeletion(false);
    }
  };

  const reauthenticationErrorMessage = (error: unknown): string => {
    // #159: reason-code mapping is centralized in localizeServerError, not
    // duplicated per call site, and its generic fallback carries a Support
    // Reference that this ad hoc version did not.
    if (isServerApiError(error)) {
      return localizeServerError(error);
    }
    return t('reauthModal.genericFailure');
  };

  const resumeDeletion = async () => {
    try {
      await finishDeletionRequest();
    } catch {
      setReauthError(t('reauthModal.retryFailed'));
    }
  };

  const handleSocialReauthentication = async (provider: 'apple' | 'google') => {
    setReauthProvider(provider);
    setReauthError(null);
    try {
      const proof = await withProtectedRoundTrip('authentication', () => provider === 'apple' ? acquireAppleProviderIdToken() : acquireGoogleProviderIdToken());
      if (proof.kind === 'cancelled') return;
      await reauthenticateWithFirebase(proof.idToken);
      await resumeDeletion();
    } catch (error: unknown) {
      setReauthError(reauthenticationErrorMessage(error));
    } finally {
      setReauthProvider(null);
    }
  };

  const handleEmailReauthentication = async (identity: ReauthenticationIdentity) => {
    if (identity.email === null) {
      setReauthError(t('reauthModal.emailMissing'));
      return;
    }
    setReauthLoading(true);
    setReauthError(null);
    try {
      await requestReauthenticationEmailCode(identity.email);
      setReauthEmail(identity.email);
      setReauthCodeSent(true);
    } catch (error: unknown) {
      setReauthError(reauthenticationErrorMessage(error));
    } finally {
      setReauthLoading(false);
    }
  };

  const handleVerifyReauthenticationCode = async () => {
    if (reauthEmail === null || reauthCode.length !== 6) return;
    setReauthLoading(true);
    setReauthError(null);
    try {
      await reauthenticateWithEmail(reauthEmail, reauthCode);
      await resumeDeletion();
    } catch (error: unknown) {
      setReauthCode('');
      setReauthError(reauthenticationErrorMessage(error));
    } finally {
      setReauthLoading(false);
    }
  };

  const handleCancelDeletion = async () => {
    setIsCancellingDeletion(true);
    try {
      await cancelDeletion();
      Alert.alert(t('accountDeletion.cancelSuccessTitle'), t('accountDeletion.cancelSuccessMessage'));
    } catch (err: unknown) {
      if (err instanceof AccountDeletionApiError && err.reauthenticationRequired) {
        Alert.alert(
          t('accountDeletion.reauthRequiredTitle'),
          t('accountDeletion.reauthRequiredMessage'),
          [
            {
              text: t('accountDeletion.signInAction'),
              onPress: () => {
                router.push('/(tabs)/(settings)/sign-in');
              },
            },
            { text: t('actions.cancel'), style: 'cancel' },
          ]
        );
      } else {
        // #159: the server's raw `message` never reaches the player; an
        // AccountDeletionApiError's `reason` maps to localized text instead.
        Alert.alert(
          t('accountDeletion.cancelFailedTitle'),
          isServerApiError(err) ? localizeServerError(err) : t('accountDeletion.cancelFailedGeneric'),
        );
      }
    } finally {
      setIsCancellingDeletion(false);
    }
  };

  return (
    <Screen scrollable contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('header.title')}</Text>
        <Text style={styles.subtitle}>
          {__DEV__
            ? t('header.subtitleDev')
            : t('header.subtitleProd')}
        </Text>
      </View>

      {/* Backend Health Section (dev-only diagnostics) */}
      {__DEV__ && (
      <>
      <Text style={styles.sectionTitle}>{t('serviceStatus.sectionTitle')}</Text>
      <Card style={styles.healthCard}>
        <View style={styles.healthHeader}>
          <Text style={styles.healthTitle}>{t('serviceStatus.apiConnectionTitle')}</Text>
          <Text style={styles.apiUrlText} numberOfLines={1} ellipsizeMode="tail">
            {Config.apiBaseUrl}
          </Text>
        </View>

        {isLoading || isRefetching ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={Theme.colors.accentTeal} />
            <Text style={styles.loadingText}>{t('serviceStatus.testingConnection')}</Text>
          </View>
        ) : error ? (
          <View style={styles.errorContainer}>
            <View style={styles.statusBadgeError}>
              <View style={[styles.statusDot, { backgroundColor: Theme.colors.error }]} />
              <Text style={styles.errorText}>{t('serviceStatus.offlineUnreachable')}</Text>
            </View>
            <Text style={styles.errorSubtext}>
              {error instanceof Error ? error.message : t('serviceStatus.unknownConnectionError')}
            </Text>
            <Button
              title={t('serviceStatus.retryConnection')}
              onPress={() => refetch()}
              variant="secondary"
              style={styles.retryButton}
              textStyle={styles.retryButtonText}
            />
          </View>
        ) : health ? (
          <View style={styles.successContainer}>
            <View style={styles.healthStatusRow}>
              <View
                style={health.status === 'ok' ? styles.statusBadgeSuccess : styles.statusBadgeError}
              >
                <View
                  style={[
                    styles.statusDot,
                    {
                      backgroundColor:
                        health.status === 'ok' ? Theme.colors.success : Theme.colors.error,
                    },
                  ]}
                />
                <Text style={health.status === 'ok' ? styles.successText : styles.errorText}>
                  {health.status === 'ok' ? t('serviceStatus.healthy') : t('serviceStatus.degraded')}
                </Text>
              </View>
            </View>

            <View style={styles.subServicesContainer}>
              <View style={styles.subServiceRow}>
                <Text style={styles.subServiceName}>{t('serviceStatus.postgresLabel')}</Text>
                <View style={styles.subServiceBadge}>
                  <View
                    style={[
                      styles.statusDotSmall,
                      {
                        backgroundColor:
                          health.checks.postgres === 'up'
                            ? Theme.colors.success
                            : Theme.colors.error,
                      },
                    ]}
                  />
                  <Text style={styles.subServiceStatus}>{health.checks.postgres}</Text>
                </View>
              </View>

              <View style={styles.subServiceDivider} />

              <View style={styles.subServiceRow}>
                <Text style={styles.subServiceName}>{t('serviceStatus.redisLabel')}</Text>
                <View style={styles.subServiceBadge}>
                  <View
                    style={[
                      styles.statusDotSmall,
                      {
                        backgroundColor:
                          health.checks.redis === 'up'
                            ? Theme.colors.success
                            : Theme.colors.error,
                      },
                    ]}
                  />
                  <Text style={styles.subServiceStatus}>{health.checks.redis}</Text>
                </View>
              </View>
            </View>
          </View>
        ) : null}
      </Card>

      {/* Session Status Section (dev-only diagnostics) */}
      <Text style={styles.sectionTitle}>{t('session.sectionTitle')}</Text>
      <Card style={styles.card}>
        <View style={styles.settingRow}>
          <View style={styles.settingTextContainer}>
            <Text style={styles.settingTitle}>{t('session.statusTitle')}</Text>
            <Text style={styles.settingDescription}>
              {t('session.statusDescription')}
            </Text>
          </View>

          {sessionLoading ? (
            <ActivityIndicator size="small" color={Theme.colors.accentTeal} />
          ) : sessionError ? (
            <View style={styles.statusBadgeError}>
              <View style={[styles.statusDot, { backgroundColor: Theme.colors.error }]} />
              <Text style={styles.errorText}>{t('session.noActiveSession')}</Text>
            </View>
          ) : sessionData ? (
            <View style={styles.sessionStatusContainer}>
              <View style={styles.statusBadgeSuccess}>
                <View style={[styles.statusDot, { backgroundColor: Theme.colors.success }]} />
                <Text style={styles.successText}>{t('session.sessionActive')}</Text>
              </View>
              <Text style={styles.sessionInfoText}>
                {t('session.idLabel', { id: shortenGuestId(sessionData.id), version: sessionData.tokenVersion })}
              </Text>
            </View>
          ) : (
            <Text style={styles.settingDescription}>{t('session.unknownState')}</Text>
          )}
        </View>
      </Card>

      <Text style={styles.sectionTitle}>{t('tutorial.sectionTitle')}</Text>
      <Card style={styles.card}>
        <Pressable
          onPress={() => void handleLearnControls()}
          style={({ pressed }) => [styles.linkRow, pressed && styles.linkPressed]}
        >
          <View style={styles.settingTextContainer}>
            <Text style={styles.settingTitle}>{t('tutorial.learnControlsTitle')}</Text>
            <Text style={styles.settingDescription}>{t('tutorial.learnControlsDescription')}</Text>
          </View>
          <Ionicons name="help-circle-outline" size={20} color={Theme.colors.textSecondary} />
        </Pressable>
      </Card>

      <Text style={styles.sectionTitle}>{t('developer.sectionTitle')}</Text>
      <Card style={styles.card}>
        <Pressable
          onPress={() => router.push('/(tabs)/(settings)/debug')}
          style={({ pressed }) => [styles.linkRow, pressed && styles.linkPressed]}
        >
          <Text style={styles.linkText}>{t('developer.debugDiagnostics')}</Text>
          <Ionicons name="chevron-forward" size={16} color={Theme.colors.textSecondary} />
        </Pressable>
      </Card>
      </>
      )}

      {/* Registered Account (email sign-in / sign-out) */}
      <AccountSection />

      {isAccount && (
        <View>
          <Text style={styles.sectionTitle}>{t('accountDeletion.sectionTitle')}</Text>
          <Card style={styles.card}>
            {deletionLoading ? (
              <View style={styles.settingRow}>
                <View style={styles.settingTextContainer}>
                  <Text style={styles.settingTitle}>{t('accountDeletion.statusTitle')}</Text>
                  <Text style={styles.settingDescription}>{t('accountDeletion.checkingStatus')}</Text>
                </View>
                <ActivityIndicator size="small" color={Theme.colors.accentRose} />
              </View>
            ) : deletionStatus?.status === 'pending' ? (
              <View style={styles.pendingDeletionContainer}>
                <View style={styles.settingTextContainer}>
                  <Text style={[styles.settingTitle, { color: Theme.colors.error }]}>{t('accountDeletion.pendingTitle')}</Text>
                  <Text style={styles.settingDescription}>{t('accountDeletion.pendingDescription')}</Text>
                  <Text style={styles.recoveryEndText}>{t('accountDeletion.recoveryWindowEnds', { date: formatRecoveryWindowEnd(deletionStatus.recoveryWindowEndsAt) })}</Text>
                </View>
                <Button title={isCancellingDeletion ? t('accountDeletion.cancelling') : t('accountDeletion.cancelDeletion')} onPress={handleCancelDeletion} disabled={isCancellingDeletion} style={styles.cancelDeletionButton} textStyle={styles.cancelDeletionButtonText} />
              </View>
            ) : (
              <View>
                {deletionError && (
                  <View style={styles.deletionStatusError}>
                    <Text style={styles.deletionStatusErrorText}>{t('accountDeletion.statusError')}</Text>
                    <Button title={t('actions.retry')} onPress={() => refetchDeletionStatus()} variant="secondary" style={styles.retryButtonSmall} textStyle={styles.retryButtonSmallText} />
                  </View>
                )}
                <Pressable
                  onPress={() => { setDeletionStage(1); setDeleteConfirmation(''); setDeleteModalVisible(true); }}
                  style={({ pressed }) => [styles.settingRow, pressed && styles.linkPressed]}
                >
                  <View style={styles.settingTextContainer}>
                    <Text style={[styles.settingTitle, { color: Theme.colors.error }]}>{t('accountDeletion.deleteAccountTitle')}</Text>
                    <Text style={styles.settingDescription}>{t('accountDeletion.deleteAccountDescription')}</Text>
                  </View>
                  <Ionicons name="trash-bin-outline" size={20} color={Theme.colors.error} />
                </Pressable>
              </View>
            )}
          </Card>
        </View>
      )}

      <Text style={styles.sectionTitle}>{t('appearance.sectionTitle')}</Text>
      <ThemeCollectionCard />

      {/* Language picker (#157): hidden behind the migration gate until
          every localization slice has landed - see src/i18n/migrationGate.ts
          and #167. */}
      {LANGUAGE_MIGRATION_GATE_OPEN && (
        <>
          <Text style={styles.sectionTitle}>{t('language.sectionTitle')}</Text>
          <Card style={styles.card}>
            <View style={styles.languageDescriptionRow}>
              <Text style={styles.settingDescription}>{t('language.description')}</Text>
            </View>
            <View style={styles.rowDivider} />
            {SUPPORTED_LOCALES.map((locale) => (
              <React.Fragment key={locale}>
                <Pressable
                  onPress={() => void handleSelectLanguage(locale)}
                  style={({ pressed }) => [styles.languageRow, pressed && styles.linkPressed]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: languageOverride === locale }}
                >
                  <Text style={styles.languageOptionText}>
                    {locale === 'tr' ? t('language.optionTurkish') : t('language.optionEnglish')}
                  </Text>
                  {languageOverride === locale && (
                    <Ionicons name="checkmark-circle" size={20} color={Theme.colors.accentTeal} />
                  )}
                </Pressable>
                <View style={styles.rowDivider} />
              </React.Fragment>
            ))}
            <Pressable
              onPress={() => void handleFollowDeviceLanguage()}
              style={({ pressed }) => [styles.languageRow, pressed && styles.linkPressed]}
              accessibilityRole="button"
              accessibilityState={{ selected: languageOverride === null }}
            >
              <View style={styles.languageFollowTextContainer}>
                <Text style={styles.languageOptionText}>{t('language.followDevice')}</Text>
                <Text style={styles.settingDescription}>{t('language.followDeviceDescription')}</Text>
              </View>
              {languageOverride === null && (
                <Ionicons name="checkmark-circle" size={20} color={Theme.colors.accentTeal} />
              )}
            </Pressable>
          </Card>
        </>
      )}

      {/* Gameplay Preferences */}
      <Text style={styles.sectionTitle}>{t('gameplay.sectionTitle')}</Text>
      <Card style={styles.card}>
        <View style={styles.settingRow}>
          <View style={styles.settingTextContainer}>
            <Text style={styles.settingTitle}>{t('gameplay.showGridLinesTitle')}</Text>
            <Text style={styles.settingDescription}>
              {t('gameplay.showGridLinesDescription')}
            </Text>
          </View>
          <Switch
            value={showGridLines}
            onValueChange={toggleGridLines}
            trackColor={{ false: Theme.colors.disabledBackground, true: Theme.colors.accentSage }}
            thumbColor={showGridLines ? Theme.colors.card : Theme.colors.disabledText}
          />
        </View>
        <View style={styles.rowDivider} />
        <View style={styles.settingRow}>
          <View style={styles.settingTextContainer}>
            <Text style={styles.settingTitle}>{t('gameplay.handednessTitle')}</Text>
            <Text style={styles.settingDescription}>
              {t('gameplay.handednessDescription')}
            </Text>
          </View>
          <View style={styles.segmentedControl}>
            <Pressable
              style={[
                styles.segmentButton,
                handedness === 'left' && styles.segmentButtonActive,
              ]}
              onPress={() => handleHandednessChange('left')}
              accessibilityRole="button"
              accessibilityLabel={t('gameplay.leftHandedLayout')}
            >
              <Text
                style={[
                  styles.segmentText,
                  handedness === 'left' && styles.segmentTextActive,
                ]}
              >
                {t('gameplay.left')}
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.segmentButton,
                handedness === 'right' && styles.segmentButtonActive,
              ]}
              onPress={() => handleHandednessChange('right')}
              accessibilityRole="button"
              accessibilityLabel={t('gameplay.rightHandedLayout')}
            >
              <Text
                style={[
                  styles.segmentText,
                  handedness === 'right' && styles.segmentTextActive,
                ]}
              >
                {t('gameplay.right')}
              </Text>
            </Pressable>
          </View>
        </View>
      </Card>

      {isAccount && (
        <>
          <Text style={styles.sectionTitle}>{t('social.sectionTitle')}</Text>
          <Card style={styles.card}>
            <Pressable
              onPress={() => router.push('/(tabs)/(settings)/blocked-creators')}
              style={({ pressed }) => [styles.linkRow, pressed && styles.linkPressed]}
            >
              <Text style={styles.linkText}>{t('social.blockedCreators')}</Text>
              <Ionicons name="chevron-forward" size={16} color={Theme.colors.textSecondary} />
            </Pressable>
          </Card>
        </>
      )}

      {/* Data Section */}
      <Text style={styles.sectionTitle}>{t('data.sectionTitle')}</Text>
      <Card style={styles.card}>
        {/* Guest Data Reset belongs to the Guest identity only; a Registered
            Account closes its identity through Account Deletion below. */}
        {!isAccount && (
          <>
            <Pressable
              disabled={isOffline}
              onPress={() => setResetModalVisible(true)}
              style={({ pressed }) => [
                styles.settingRow,
                isOffline && styles.rowDisabled,
                pressed && styles.linkPressed,
              ]}
            >
              <View style={styles.settingTextContainer}>
                <Text style={[styles.settingTitle, { color: Theme.colors.error }]}>
                  {t('data.resetGuestTitle')}
                </Text>
                <Text style={styles.settingDescription}>
                  {t('data.resetGuestDescription')}
                </Text>
                {isOffline && (
                  <Text style={styles.offlineExplanation}>
                    {t('data.resetGuestOffline')}
                  </Text>
                )}
                <Text style={styles.offlineExplanation}>
                  {t('data.resetGuestPurchaseLock')}
                </Text>
              </View>
              <Ionicons
                name="trash-outline"
                size={20}
                color={isOffline ? Theme.colors.disabledText : Theme.colors.error}
              />
            </Pressable>

            <View style={styles.rowDivider} />
          </>
        )}

        <Pressable
          onPress={handleRemoveLocalData}
          style={({ pressed }) => [
            styles.settingRow,
            pressed && styles.linkPressed,
          ]}
        >
          <View style={styles.settingTextContainer}>
            <Text style={[styles.settingTitle, { color: Theme.colors.error }]}>
              {t('data.removeLocalTitle')}
            </Text>
            <Text style={styles.settingDescription}>
              {t('data.removeLocalDescription')}
            </Text>
          </View>
          <Ionicons name="phone-portrait-outline" size={20} color={Theme.colors.error} />
        </Pressable>

      </Card>

      {/* Links Section */}
      <Text style={styles.sectionTitle}>{t('links.sectionTitle')}</Text>
      <Card style={styles.card}>
        <Pressable
          onPress={() => handleLinkPress(t('links.privacyPolicy'), WebLinks.privacyPolicy)}
          style={({ pressed }) => [styles.linkRow, pressed && styles.linkPressed]}
        >
          <Text style={styles.linkText}>{t('links.privacyPolicy')}</Text>
          <Ionicons name="chevron-forward" size={16} color={Theme.colors.textSecondary} />
        </Pressable>
        <View style={styles.rowDivider} />

        <Pressable
          onPress={() => handleLinkPress(t('links.termsOfService'), WebLinks.termsOfService)}
          style={({ pressed }) => [styles.linkRow, pressed && styles.linkPressed]}
        >
          <Text style={styles.linkText}>{t('links.termsOfService')}</Text>
          <Ionicons name="chevron-forward" size={16} color={Theme.colors.textSecondary} />
        </Pressable>
        <View style={styles.rowDivider} />

        <Pressable
          onPress={() => handleLinkPress(t('links.contactSupport'), WebLinks.support)}
          style={({ pressed }) => [styles.linkRow, pressed && styles.linkPressed]}
        >
          <Text style={styles.linkText}>{t('links.contactSupport')}</Text>
          <Ionicons name="chevron-forward" size={16} color={Theme.colors.textSecondary} />
        </Pressable>
        <View style={styles.rowDivider} />

        <Pressable
          onPress={() => handleLinkPress(t('links.accountDeletion'), WebLinks.accountDeletion)}
          style={({ pressed }) => [styles.linkRow, pressed && styles.linkPressed]}
        >
          <Text style={styles.linkText}>{t('links.accountDeletion')}</Text>
          <Ionicons name="chevron-forward" size={16} color={Theme.colors.textSecondary} />
        </Pressable>
      </Card>

      {/* App details card */}
      <View style={styles.appDetails}>
        <Text style={styles.appDetailsText}>{t('appDetails.appName')}</Text>
        <Text style={styles.appDetailsVersion}>{t('appDetails.version', { version: appVersion })}</Text>
        {__DEV__ && (
          <>
            {sdkVersion !== undefined && (
              <Text style={styles.appDetailsVersion}>{t('appDetails.sdk', { sdk: sdkVersion })}</Text>
            )}
            <Text style={styles.appDetailsIdentifier}>{t('appDetails.packageLabel', { id: appIdentifier })}</Text>
            <Text style={styles.appDetailsScheme}>{t('appDetails.schemeLabel', { scheme: appScheme })}</Text>
          </>
        )}
      </View>

      <Modal
        visible={resetModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isResetting) setResetModalVisible(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('resetModal.title')}</Text>

            <Text style={styles.modalWarningText}>
              {t('resetModal.warning')}
            </Text>

            <View style={styles.bulletsContainer}>
              <Text style={styles.bulletItem}>{t('resetModal.bulletProgress')}</Text>
              <Text style={styles.bulletItem}>{t('resetModal.bulletRewards')}</Text>
              <Text style={styles.bulletItem}>{t('resetModal.bulletLikes')}</Text>
              <Text style={styles.bulletItem}>{t('resetModal.bulletUnlockAccess')}</Text>
              <Text style={styles.bulletItem}>{t('resetModal.bulletOfflinePatterns')}</Text>
            </View>

            <Text style={styles.confirmationInstruction}>
              {t('resetModal.confirmPrefix')}<Text style={{ fontWeight: 'bold' }}>RESET</Text>{t('resetModal.confirmSuffix')}
            </Text>

            <TextInput
              style={styles.textInput}
              value={typedConfirmation}
              onChangeText={setTypedConfirmation}
              placeholder="RESET"
              placeholderTextColor={Theme.colors.textSecondary}
              autoCapitalize="characters"
              editable={!isResetting}
            />

            {isResetting ? (
              <View style={styles.modalLoadingContainer}>
                <ActivityIndicator size="small" color={Theme.colors.error} />
                <Text style={styles.modalLoadingText}>{t('resetModal.resetting')}</Text>
              </View>
            ) : (
              <View style={styles.modalButtonsRow}>
                <Button
                  title={t('actions.cancel')}
                  onPress={() => {
                    setResetModalVisible(false);
                    setTypedConfirmation('');
                  }}
                  variant="secondary"
                  style={styles.modalCancelButton}
                />
                <Button
                  title={t('resetModal.confirmAction')}
                  onPress={handleResetGuestData}
                  disabled={typedConfirmation !== 'RESET' || isOffline}
                  style={
                    typedConfirmation === 'RESET' && !isOffline
                      ? { backgroundColor: Theme.colors.error }
                      : undefined
                  }
                  textStyle={
                    typedConfirmation === 'RESET' && !isOffline
                      ? { color: Theme.colors.textLight }
                      : undefined
                  }
                />
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={deleteModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isSubmittingDeletion) setDeleteModalVisible(false);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {deletionStage === 1 ? (
              <View>
                <Text style={styles.modalTitle}>{t('deleteModal.title')}</Text>

                <Text style={styles.modalWarningText}>
                  {t('deleteModal.recoveryPrefix')}<Text style={{ fontWeight: 'bold' }}>{t('deleteModal.recoveryBold')}</Text>{t('deleteModal.recoverySuffix')}
                </Text>

                <View style={styles.bulletsContainer}>
                  <Text style={styles.bulletItem}>{t('deleteModal.bulletBalances')}</Text>
                  <Text style={styles.bulletItem}>{t('deleteModal.bulletUnlocks')}</Text>
                  <Text style={styles.bulletItem}>{t('deleteModal.bulletArtwork')}</Text>
                  <Text style={styles.bulletItem}>{t('deleteModal.bulletProgress')}</Text>
                </View>

                <Text style={styles.modalWarningText}>
                  {t('deleteModal.consequencesPrefix')}<Text style={{ fontWeight: 'bold' }}>{t('deleteModal.consequencesBold')}</Text>{t('deleteModal.consequencesSuffix')}
                </Text>

                {membership?.active && (
                  <View style={styles.membershipDeletionWarning}>
                    <Text style={[styles.modalWarningText, { color: Theme.colors.error, fontWeight: Theme.typography.weights.medium }]}>
                      {t('deleteModal.membershipWarning')}
                    </Text>
                    {Platform.OS === 'ios' && (
                      <Button
                        title={t('deleteModal.manageAppleSubscription')}
                        onPress={handleSubscriptionManagePress}
                        variant="secondary"
                        style={styles.manageSubscriptionButton}
                        textStyle={styles.manageSubscriptionButtonText}
                      />
                    )}
                  </View>
                )}

                <View style={[styles.modalButtonsRow, { marginTop: Theme.spacing.lg }]}>
                  <Button
                    title={t('actions.cancel')}
                    onPress={() => setDeleteModalVisible(false)}
                    variant="secondary"
                    style={styles.modalCancelButton}
                  />
                  <Button
                    title={t('deleteModal.continueAction')}
                    onPress={() => setDeletionStage(2)}
                    style={{ backgroundColor: Theme.colors.error }}
                    textStyle={{ color: Theme.colors.textLight }}
                  />
                </View>
              </View>
            ) : (
              <View>
                <Text style={styles.modalTitle}>{t('deleteModal.confirmTitle')}</Text>

                <Text style={styles.modalWarningText}>
                  {t('deleteModal.confirmPrefix')}<Text style={{ fontWeight: 'bold' }}>DELETE</Text>{t('deleteModal.confirmSuffix')}
                </Text>

                <TextInput
                  style={styles.textInput}
                  value={deleteConfirmation}
                  onChangeText={setDeleteConfirmation}
                  placeholder="DELETE"
                  placeholderTextColor={Theme.colors.textSecondary}
                  autoCapitalize="characters"
                  editable={!isSubmittingDeletion}
                />

                {isSubmittingDeletion ? (
                  <View style={styles.modalLoadingContainer}>
                    <ActivityIndicator size="small" color={Theme.colors.error} />
                    <Text style={styles.modalLoadingText}>{t('deleteModal.submitting')}</Text>
                  </View>
                ) : (
                  <View style={styles.modalButtonsRow}>
                    <Button
                      title={t('deleteModal.backAction')}
                      onPress={() => setDeletionStage(1)}
                      variant="secondary"
                      style={styles.modalCancelButton}
                    />
                    <Button
                      title={t('deleteModal.confirmAction')}
                      onPress={handleRequestDeletion}
                      disabled={deleteConfirmation !== 'DELETE'}
                      style={
                        deleteConfirmation === 'DELETE'
                          ? { backgroundColor: Theme.colors.error }
                          : undefined
                      }
                      textStyle={
                        deleteConfirmation === 'DELETE'
                          ? { color: Theme.colors.textLight }
                          : undefined
                      }
                    />
                  </View>
                )}
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Modal
        visible={reauthVisible}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!reauthLoading && reauthProvider === null) setReauthVisible(false); }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('reauthModal.title')}</Text>
            <Text style={styles.modalWarningText}>{t('reauthModal.description')}</Text>

            {reauthError && <Text style={styles.reauthErrorText}>{reauthError}</Text>}

            {reauthLoading && !reauthCodeSent ? (
              <View style={styles.modalLoadingContainer}>
                <ActivityIndicator size="small" color={Theme.colors.accentRose} />
                <Text style={styles.modalLoadingText}>{t('reauthModal.loading')}</Text>
              </View>
            ) : reauthCodeSent ? (
              <View>
                <Text style={styles.confirmationInstruction}>{t('reauthModal.codeSentMessage', { email: reauthEmail })}</Text>
                <TextInput
                  style={styles.textInput}
                  value={reauthCode}
                  onChangeText={(value) => setReauthCode(value.replace(/[^0-9]/g, ''))}
                  placeholder="000000"
                  placeholderTextColor={Theme.colors.textSecondary}
                  keyboardType="number-pad"
                  maxLength={6}
                  editable={!reauthLoading}
                />
                <Button title={t('reauthModal.verifyAndDelete')} onPress={handleVerifyReauthenticationCode} disabled={reauthCode.length !== 6 || reauthLoading} loading={reauthLoading} />
              </View>
            ) : (
              <View style={styles.reauthProviders}>
                {reauthIdentities.map((identity) => (
                  <Button
                    key={`${identity.provider}:${identity.email ?? ''}`}
                    title={
                      identity.provider === 'email'
                        ? t('reauthModal.emailButton', { email: identity.email ?? '' }).trim()
                        : t('reauthModal.continueWithProvider', {
                            provider: identity.provider === 'apple' ? t('reauthModal.providerApple') : t('reauthModal.providerGoogle'),
                          })
                    }
                    onPress={() => identity.provider === 'email' ? void handleEmailReauthentication(identity) : void handleSocialReauthentication(identity.provider)}
                    disabled={reauthProvider !== null || reauthLoading}
                    loading={reauthProvider === identity.provider}
                    variant="secondary"
                  />
                ))}
                {reauthIdentities.length === 0 && !reauthError && (
                  <Text style={styles.reauthErrorText}>{t('reauthModal.noLinkedMethod')}</Text>
                )}
              </View>
            )}

            <View style={styles.reauthFooter}>
              {reauthError && !reauthCodeSent && (
                <Button title={t('actions.retry')} onPress={() => void openReauthentication()} variant="secondary" disabled={reauthLoading} />
              )}
              <Button title={t('actions.cancel')} onPress={() => setReauthVisible(false)} variant="secondary" disabled={reauthLoading || reauthProvider !== null} />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: Theme.spacing.xl,
    paddingHorizontal: Theme.spacing.lg,
    paddingBottom: 100,
  },
  header: {
    marginBottom: Theme.spacing.xl,
  },
  title: {
    fontSize: Theme.typography.sizes.xxxl,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.accentRose,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    marginTop: Theme.spacing.xs,
  },
  sectionTitle: {
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1.0,
    marginTop: Theme.spacing.lg,
    marginBottom: Theme.spacing.sm,
    paddingLeft: Theme.spacing.xs,
  },
  card: {
    padding: 0,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Theme.spacing.lg,
  },
  settingTextContainer: {
    flex: 1,
    paddingRight: Theme.spacing.md,
  },
  settingTitle: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  settingDescription: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    marginTop: Theme.spacing.xs,
  },
  healthCard: {
    padding: Theme.spacing.lg,
  },
  healthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.md,
  },
  healthTitle: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  apiUrlText: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    maxWidth: '50%',
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Theme.spacing.md,
    gap: Theme.spacing.sm,
  },
  loadingText: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
  },
  errorContainer: {
    alignItems: 'center',
    paddingVertical: Theme.spacing.sm,
  },
  statusBadgeError: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FDF2F2',
    borderWidth: 1,
    borderColor: '#FBD5D5',
    paddingVertical: Theme.spacing.xs,
    paddingHorizontal: Theme.spacing.sm,
    borderRadius: Theme.radii.sm,
    marginBottom: Theme.spacing.xs,
    gap: Theme.spacing.xs,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: Theme.radii.full,
  },
  errorText: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.error,
  },
  errorSubtext: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: Theme.spacing.md,
  },
  retryButton: {
    height: 36,
    paddingHorizontal: Theme.spacing.md,
  },
  retryButtonText: {
    fontSize: Theme.typography.sizes.sm,
  },
  successContainer: {
    paddingTop: Theme.spacing.xs,
  },
  healthStatusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Theme.spacing.md,
  },
  statusBadgeSuccess: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3FAF4',
    borderWidth: 1,
    borderColor: '#DEF7EC',
    paddingVertical: Theme.spacing.xs,
    paddingHorizontal: Theme.spacing.sm,
    borderRadius: Theme.radii.sm,
    gap: Theme.spacing.xs,
  },
  successText: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.success,
  },
  subServicesContainer: {
    backgroundColor: '#FAF8F5',
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.md,
    paddingHorizontal: Theme.spacing.md,
  },
  subServiceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Theme.spacing.md,
  },
  subServiceName: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textPrimary,
    fontWeight: Theme.typography.weights.medium,
  },
  subServiceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.xs,
  },
  statusDotSmall: {
    width: 6,
    height: 6,
    borderRadius: Theme.radii.full,
  },
  subServiceStatus: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textSecondary,
    textTransform: 'capitalize',
  },
  subServiceDivider: {
    height: 1,
    backgroundColor: Theme.colors.border,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Theme.spacing.lg,
  },
  linkPressed: {
    backgroundColor: '#FAF8F5',
  },
  linkText: {
    fontSize: Theme.typography.sizes.md,
    color: Theme.colors.textPrimary,
    fontWeight: Theme.typography.weights.medium,
  },
  rowDivider: {
    height: 1,
    backgroundColor: Theme.colors.border,
    marginHorizontal: Theme.spacing.lg,
  },
  appDetails: {
    alignItems: 'center',
    marginTop: Theme.spacing.xxl,
    marginBottom: Theme.spacing.xl,
    gap: Theme.spacing.xs,
  },
  appDetailsText: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textSecondary,
  },
  appDetailsVersion: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
  },
  appDetailsIdentifier: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    opacity: 0.8,
  },
  appDetailsScheme: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    opacity: 0.8,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: '#EFECE6',
    borderRadius: Theme.radii.md,
    padding: 2,
    width: 140,
    height: 36,
  },
  segmentButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: Theme.radii.sm,
  },
  segmentButtonActive: {
    backgroundColor: Theme.colors.card,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentText: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.medium,
    color: Theme.colors.textSecondary,
  },
  segmentTextActive: {
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  sessionStatusContainer: {
    alignItems: 'flex-end',
  },
  sessionInfoText: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    marginTop: Theme.spacing.xs,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Theme.spacing.xl,
  },
  modalContent: {
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.lg,
    padding: Theme.spacing.xl,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 5,
  },
  modalTitle: {
    fontSize: Theme.typography.sizes.xl,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.error,
    marginBottom: Theme.spacing.md,
    textAlign: 'center',
  },
  modalWarningText: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textPrimary,
    lineHeight: 20,
    marginBottom: Theme.spacing.md,
  },
  bulletsContainer: {
    backgroundColor: '#FAF8F5',
    borderRadius: Theme.radii.md,
    padding: Theme.spacing.md,
    marginBottom: Theme.spacing.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  bulletItem: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textPrimary,
    lineHeight: 22,
  },
  confirmationInstruction: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    marginBottom: Theme.spacing.sm,
  },
  textInput: {
    borderWidth: 1,
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.md,
    paddingVertical: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.md,
    fontSize: Theme.typography.sizes.md,
    color: Theme.colors.textPrimary,
    backgroundColor: '#FAF8F5',
    marginBottom: Theme.spacing.lg,
    textAlign: 'center',
    fontWeight: 'bold',
  },
  modalLoadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Theme.spacing.sm,
    paddingVertical: Theme.spacing.md,
  },
  modalLoadingText: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
  },
  modalButtonsRow: {
    flexDirection: 'row',
    gap: Theme.spacing.md,
  },
  modalCancelButton: {
    flex: 1,
  },
  modalConfirmButton: {
    flex: 1,
    height: 48,
  },
  offlineExplanation: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.error,
    marginTop: Theme.spacing.xs,
    fontWeight: Theme.typography.weights.semibold,
  },
  rowDisabled: {
    opacity: 0.5,
  },
  pendingDeletionContainer: {
    padding: Theme.spacing.lg,
    gap: Theme.spacing.md,
  },
  recoveryEndText: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.error,
    marginTop: Theme.spacing.xs,
  },
  cancelDeletionButton: {
    backgroundColor: Theme.colors.accentSage,
    height: 40,
    alignSelf: 'flex-start',
    marginTop: Theme.spacing.xs,
  },
  cancelDeletionButtonText: {
    color: Theme.colors.textLight,
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.bold,
  },
  retryButtonSmall: {
    height: 32,
    paddingHorizontal: Theme.spacing.md,
  },
  retryButtonSmallText: {
    fontSize: Theme.typography.sizes.xs,
  },
  deletionStatusError: {
    padding: Theme.spacing.lg,
    paddingBottom: 0,
    gap: Theme.spacing.sm,
    alignItems: 'flex-start',
  },
  deletionStatusErrorText: {
    color: Theme.colors.error,
    fontSize: Theme.typography.sizes.sm,
    lineHeight: 18,
  },
  membershipDeletionWarning: {
    marginBottom: Theme.spacing.md,
  },
  reauthProviders: {
    gap: Theme.spacing.md,
  },
  reauthErrorText: {
    color: Theme.colors.error,
    fontSize: Theme.typography.sizes.sm,
    lineHeight: 18,
    marginBottom: Theme.spacing.md,
  },
  reauthFooter: {
    gap: Theme.spacing.sm,
    marginTop: Theme.spacing.lg,
  },
  manageSubscriptionButton: {
    height: 40,
    alignSelf: 'stretch',
    marginTop: Theme.spacing.xs,
  },
  manageSubscriptionButtonText: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textPrimary,
  },
  languageDescriptionRow: {
    paddingHorizontal: Theme.spacing.lg,
    paddingTop: Theme.spacing.lg,
    paddingBottom: Theme.spacing.sm,
  },
  languageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Theme.spacing.lg,
    paddingStart: Theme.spacing.lg,
    paddingEnd: Theme.spacing.lg,
  },
  languageOptionText: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.medium,
    color: Theme.colors.textPrimary,
  },
  languageFollowTextContainer: {
    flex: 1,
    marginEnd: Theme.spacing.md,
    gap: Theme.spacing.xs,
  },
});
