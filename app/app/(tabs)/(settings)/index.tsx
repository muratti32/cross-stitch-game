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
  AccountReauthenticationApiError,
  getReauthenticationIdentities,
  reauthenticateWithEmail,
  reauthenticateWithFirebase,
  requestReauthenticationEmailCode,
  type ReauthenticationIdentity,
} from '@/api/accountReauthentication';
import { acquireAppleProviderIdToken, acquireGoogleProviderIdToken } from '@/identity/firebaseSso';
import { loadOnboardingState, resumeTutorial, saveOnboardingPosition } from '@/onboarding/state';

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

  const isOffline = !isLoading && (!!error || !health || health.status !== 'ok');

  const formatRecoveryWindowEnd = (recoveryWindowEndsAt?: string): string => {
    if (!recoveryWindowEndsAt) {
      return 'Unavailable';
    }

    const endDate = new Date(recoveryWindowEndsAt);
    return Number.isNaN(endDate.getTime())
      ? 'Unavailable'
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
      Alert.alert('Success', 'Guest data has been fully reset.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      Alert.alert('Reset Failed', `Guest data reset failed: ${msg}. Please try again.`);
    } finally {
      setIsResetting(false);
    }
  };

  const handleRemoveLocalData = () => {
    Alert.alert(
      'Remove Local Data?',
      'Warning: This will delete your local database files from this device only. Any unsynchronized records will be permanently lost.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setIsRemovingLocal(true);
            try {
              await removeLocalData();
              Alert.alert('Success', 'Local data has been removed from this device.');
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : 'Unknown error';
              Alert.alert('Removal Failed', `Failed to remove local data: ${msg}`);
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
      Alert.alert('Tutorial unavailable', 'Could not resume the tutorial. Please try again.');
    }
  };

  const handleLinkPress = (title: string, url: string) => {
    void withProtectedRoundTrip('external-link', () => Linking.openURL(url), {
      keepUntilForeground: true,
    }).catch(() => {
      Alert.alert(title, `Could not open link: ${url}`);
    });
  };

  const handleSubscriptionManagePress = () => {
    const url = Platform.OS === 'ios'
      ? 'https://apps.apple.com/account/subscriptions'
      : 'https://play.google.com/store/account/subscriptions';
    void withProtectedRoundTrip('subscription-management', () => Linking.openURL(url), {
      keepUntilForeground: true,
    }).catch(() => {
      Alert.alert('Error', `Could not open link: ${url}`);
    });
  };

  const finishDeletionRequest = async () => {
    const result = await requestDeletion();
    setDeleteModalVisible(false);
    setReauthVisible(false);
    setDeleteConfirmation('');
    setDeletionStage(1);
    Alert.alert(
      'Account Deletion Requested',
      `Your deletion request is pending through ${formatRecoveryWindowEnd(result.recoveryWindowEndsAt)}. Your account has been logged out. Sign in again before then if you wish to cancel this deletion.`,
    );
    void logout().catch(() => {
      Alert.alert('Local Sign-out Failed', 'Your deletion request is still pending. Please sign out again from Settings.');
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
      setReauthError('Could not load your linked sign-in methods. Check your connection and retry.');
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
        Alert.alert('Request Failed', 'Your deletion request was not submitted. Check your connection and try again.');
      }
    } finally {
      setIsSubmittingDeletion(false);
    }
  };

  const reauthenticationErrorMessage = (error: unknown): string => {
    if (error instanceof AccountReauthenticationApiError && error.reason === 'different_account') {
      return 'That sign-in belongs to a different account. Your current account was not changed.';
    }
    if (error instanceof AccountReauthenticationApiError && error.reason === 'provider_rejected') {
      return 'That verification was rejected. Check the account or code and retry.';
    }
    return 'Reauthentication failed. Check your connection and retry.';
  };

  const resumeDeletion = async () => {
    try {
      await finishDeletionRequest();
    } catch {
      setReauthError('Your identity was verified, but deletion was not submitted. Close this dialog and retry deletion.');
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
      setReauthError('This linked email method has no address. Choose another method.');
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
      Alert.alert('Success', 'Your account deletion request has been cancelled.');
    } catch (err: unknown) {
      if (err instanceof AccountDeletionApiError && err.reauthenticationRequired) {
        Alert.alert(
          'Reauthentication Required',
          'For security, you must sign in again before cancelling account deletion.',
          [
            {
              text: 'Sign In',
              onPress: () => {
                router.push('/(tabs)/(settings)/sign-in');
              },
            },
            { text: 'Cancel', style: 'cancel' },
          ]
        );
      } else {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        Alert.alert('Cancel Failed', `Failed to cancel account deletion: ${msg}`);
      }
    } finally {
      setIsCancellingDeletion(false);
    }
  };

  return (
    <Screen scrollable contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>
          {__DEV__
            ? 'Configure preferences and inspect backend systems.'
            : 'Configure your preferences.'}
        </Text>
      </View>

      {/* Backend Health Section (dev-only diagnostics) */}
      {__DEV__ && (
      <>
      <Text style={styles.sectionTitle}>Service Status</Text>
      <Card style={styles.healthCard}>
        <View style={styles.healthHeader}>
          <Text style={styles.healthTitle}>API connection</Text>
          <Text style={styles.apiUrlText} numberOfLines={1} ellipsizeMode="tail">
            {Config.apiBaseUrl}
          </Text>
        </View>

        {isLoading || isRefetching ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={Theme.colors.accentTeal} />
            <Text style={styles.loadingText}>Testing api connection...</Text>
          </View>
        ) : error ? (
          <View style={styles.errorContainer}>
            <View style={styles.statusBadgeError}>
              <View style={[styles.statusDot, { backgroundColor: Theme.colors.error }]} />
              <Text style={styles.errorText}>Offline / Unreachable</Text>
            </View>
            <Text style={styles.errorSubtext}>
              {error instanceof Error ? error.message : 'Unknown connection error'}
            </Text>
            <Button
              title="Retry Connection"
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
                  {health.status === 'ok' ? 'Healthy' : 'Degraded'}
                </Text>
              </View>
            </View>

            <View style={styles.subServicesContainer}>
              <View style={styles.subServiceRow}>
                <Text style={styles.subServiceName}>PostgreSQL Database</Text>
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
                <Text style={styles.subServiceName}>Redis Cache</Text>
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
      <Text style={styles.sectionTitle}>Identity & Session</Text>
      <Card style={styles.card}>
        <View style={styles.settingRow}>
          <View style={styles.settingTextContainer}>
            <Text style={styles.settingTitle}>Backend Session Status</Text>
            <Text style={styles.settingDescription}>
              Validates your active guest registration session via the API.
            </Text>
          </View>

          {sessionLoading ? (
            <ActivityIndicator size="small" color={Theme.colors.accentTeal} />
          ) : sessionError ? (
            <View style={styles.statusBadgeError}>
              <View style={[styles.statusDot, { backgroundColor: Theme.colors.error }]} />
              <Text style={styles.errorText}>No Active Session</Text>
            </View>
          ) : sessionData ? (
            <View style={styles.sessionStatusContainer}>
              <View style={styles.statusBadgeSuccess}>
                <View style={[styles.statusDot, { backgroundColor: Theme.colors.success }]} />
                <Text style={styles.successText}>Session Active</Text>
              </View>
              <Text style={styles.sessionInfoText}>
                ID: {shortenGuestId(sessionData.id)} (v{sessionData.tokenVersion})
              </Text>
            </View>
          ) : (
            <Text style={styles.settingDescription}>Unknown state</Text>
          )}
        </View>
      </Card>

      <Text style={styles.sectionTitle}>Tutorial</Text>
      <Card style={styles.card}>
        <Pressable
          onPress={() => void handleLearnControls()}
          style={({ pressed }) => [styles.linkRow, pressed && styles.linkPressed]}
        >
          <View style={styles.settingTextContainer}>
            <Text style={styles.settingTitle}>Learn the controls</Text>
            <Text style={styles.settingDescription}>Resume the stitching tutorial when you are ready.</Text>
          </View>
          <Ionicons name="help-circle-outline" size={20} color={Theme.colors.textSecondary} />
        </Pressable>
      </Card>

      <Text style={styles.sectionTitle}>Developer</Text>
      <Card style={styles.card}>
        <Pressable
          onPress={() => router.push('/(tabs)/(settings)/debug')}
          style={({ pressed }) => [styles.linkRow, pressed && styles.linkPressed]}
        >
          <Text style={styles.linkText}>Debug / Diagnostics</Text>
          <Ionicons name="chevron-forward" size={16} color={Theme.colors.textSecondary} />
        </Pressable>
      </Card>
      </>
      )}

      {/* Registered Account (email sign-in / sign-out) */}
      <AccountSection />

      {isAccount && (
        <View>
          <Text style={styles.sectionTitle}>Account Deletion</Text>
          <Card style={styles.card}>
            {deletionLoading ? (
              <View style={styles.settingRow}>
                <View style={styles.settingTextContainer}>
                  <Text style={styles.settingTitle}>Account Deletion Status</Text>
                  <Text style={styles.settingDescription}>Checking status...</Text>
                </View>
                <ActivityIndicator size="small" color={Theme.colors.accentRose} />
              </View>
            ) : deletionStatus?.status === 'pending' ? (
              <View style={styles.pendingDeletionContainer}>
                <View style={styles.settingTextContainer}>
                  <Text style={[styles.settingTitle, { color: Theme.colors.error }]}>Account Deletion Pending</Text>
                  <Text style={styles.settingDescription}>Your account deletion is scheduled. Sign in again before the recovery window ends to cancel it.</Text>
                  <Text style={styles.recoveryEndText}>Recovery Window Ends: {formatRecoveryWindowEnd(deletionStatus.recoveryWindowEndsAt)}</Text>
                </View>
                <Button title={isCancellingDeletion ? 'Cancelling...' : 'Cancel deletion'} onPress={handleCancelDeletion} disabled={isCancellingDeletion} style={styles.cancelDeletionButton} textStyle={styles.cancelDeletionButtonText} />
              </View>
            ) : (
              <View>
                {deletionError && (
                  <View style={styles.deletionStatusError}>
                    <Text style={styles.deletionStatusErrorText}>Could not check deletion status. Check your connection and retry.</Text>
                    <Button title="Retry" onPress={() => refetchDeletionStatus()} variant="secondary" style={styles.retryButtonSmall} textStyle={styles.retryButtonSmallText} />
                  </View>
                )}
                <Pressable
                  onPress={() => { setDeletionStage(1); setDeleteConfirmation(''); setDeleteModalVisible(true); }}
                  style={({ pressed }) => [styles.settingRow, pressed && styles.linkPressed]}
                >
                  <View style={styles.settingTextContainer}>
                    <Text style={[styles.settingTitle, { color: Theme.colors.error }]}>Delete Account</Text>
                    <Text style={styles.settingDescription}>Permanently delete your account, progress, and all unlocks after a 30-day recovery window.</Text>
                  </View>
                  <Ionicons name="trash-bin-outline" size={20} color={Theme.colors.error} />
                </Pressable>
              </View>
            )}
          </Card>
        </View>
      )}

      <Text style={styles.sectionTitle}>Appearance</Text>
      <ThemeCollectionCard />

      {/* Gameplay Preferences */}
      <Text style={styles.sectionTitle}>Gameplay Settings</Text>
      <Card style={styles.card}>
        <View style={styles.settingRow}>
          <View style={styles.settingTextContainer}>
            <Text style={styles.settingTitle}>Show Grid Lines</Text>
            <Text style={styles.settingDescription}>
              Display boundaries between sewing canvas cells
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
            <Text style={styles.settingTitle}>Handedness Layout</Text>
            <Text style={styles.settingDescription}>
              Align interactive controls for left- or right-handed play
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
              accessibilityLabel="Left handed layout"
            >
              <Text
                style={[
                  styles.segmentText,
                  handedness === 'left' && styles.segmentTextActive,
                ]}
              >
                Left
              </Text>
            </Pressable>
            <Pressable
              style={[
                styles.segmentButton,
                handedness === 'right' && styles.segmentButtonActive,
              ]}
              onPress={() => handleHandednessChange('right')}
              accessibilityRole="button"
              accessibilityLabel="Right handed layout"
            >
              <Text
                style={[
                  styles.segmentText,
                  handedness === 'right' && styles.segmentTextActive,
                ]}
              >
                Right
              </Text>
            </Pressable>
          </View>
        </View>
      </Card>

      {isAccount && (
        <>
          <Text style={styles.sectionTitle}>Social & Privacy</Text>
          <Card style={styles.card}>
            <Pressable
              onPress={() => router.push('/(tabs)/(settings)/blocked-creators')}
              style={({ pressed }) => [styles.linkRow, pressed && styles.linkPressed]}
            >
              <Text style={styles.linkText}>Blocked Creators</Text>
              <Ionicons name="chevron-forward" size={16} color={Theme.colors.textSecondary} />
            </Pressable>
          </Card>
        </>
      )}

      {/* Data Section */}
      <Text style={styles.sectionTitle}>Data</Text>
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
                  Reset guest data
                </Text>
                <Text style={styles.settingDescription}>
                  Irreversibly close the guest identity on the server and wipe all device data.
                </Text>
                {isOffline && (
                  <Text style={styles.offlineExplanation}>
                    Offline: Active server connection required to reset guest data.
                  </Text>
                )}
                <Text style={styles.offlineExplanation}>
                  Reset is blocked while a purchase is still being verified. Consumables and private Guest data cannot be recovered afterward.
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
              Remove local data
            </Text>
            <Text style={styles.settingDescription}>
              Delete your local identity namespace database from this device.
            </Text>
          </View>
          <Ionicons name="phone-portrait-outline" size={20} color={Theme.colors.error} />
        </Pressable>

      </Card>

      {/* Links Section */}
      <Text style={styles.sectionTitle}>Information & Links</Text>
      <Card style={styles.card}>
        <Pressable
          onPress={() => handleLinkPress('Privacy Policy', WebLinks.privacyPolicy)}
          style={({ pressed }) => [styles.linkRow, pressed && styles.linkPressed]}
        >
          <Text style={styles.linkText}>Privacy Policy</Text>
          <Ionicons name="chevron-forward" size={16} color={Theme.colors.textSecondary} />
        </Pressable>
        <View style={styles.rowDivider} />

        <Pressable
          onPress={() => handleLinkPress('Terms of Service', WebLinks.termsOfService)}
          style={({ pressed }) => [styles.linkRow, pressed && styles.linkPressed]}
        >
          <Text style={styles.linkText}>Terms of Service</Text>
          <Ionicons name="chevron-forward" size={16} color={Theme.colors.textSecondary} />
        </Pressable>
        <View style={styles.rowDivider} />

        <Pressable
          onPress={() => handleLinkPress('Contact Support', WebLinks.support)}
          style={({ pressed }) => [styles.linkRow, pressed && styles.linkPressed]}
        >
          <Text style={styles.linkText}>Contact Support</Text>
          <Ionicons name="chevron-forward" size={16} color={Theme.colors.textSecondary} />
        </Pressable>
        <View style={styles.rowDivider} />

        <Pressable
          onPress={() => handleLinkPress('Account Deletion', WebLinks.accountDeletion)}
          style={({ pressed }) => [styles.linkRow, pressed && styles.linkPressed]}
        >
          <Text style={styles.linkText}>Account Deletion</Text>
          <Ionicons name="chevron-forward" size={16} color={Theme.colors.textSecondary} />
        </Pressable>
      </Card>

      {/* App details card */}
      <View style={styles.appDetails}>
        <Text style={styles.appDetailsText}>Stitch Wish — Cozy Pixel-Art Needlecraft</Text>
        <Text style={styles.appDetailsVersion}>Version {appVersion}</Text>
        {__DEV__ && (
          <>
            {sdkVersion !== undefined && (
              <Text style={styles.appDetailsVersion}>Expo SDK {sdkVersion}</Text>
            )}
            <Text style={styles.appDetailsIdentifier}>Package: {appIdentifier}</Text>
            <Text style={styles.appDetailsScheme}>Scheme: {appScheme}://</Text>
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
            <Text style={styles.modalTitle}>Reset Guest Data?</Text>

            <Text style={styles.modalWarningText}>
              This action will irreversibly close your guest identity on the server and permanently delete your:
            </Text>

            <View style={styles.bulletsContainer}>
              <Text style={styles.bulletItem}>• local progress</Text>
              <Text style={styles.bulletItem}>• pending rewards</Text>
              <Text style={styles.bulletItem}>• likes</Text>
              <Text style={styles.bulletItem}>• unlock access</Text>
              <Text style={styles.bulletItem}>• offline pattern data</Text>
            </View>

            <Text style={styles.confirmationInstruction}>
              Type <Text style={{ fontWeight: 'bold' }}>RESET</Text> below to confirm:
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
                <Text style={styles.modalLoadingText}>Resetting guest data...</Text>
              </View>
            ) : (
              <View style={styles.modalButtonsRow}>
                <Button
                  title="Cancel"
                  onPress={() => {
                    setResetModalVisible(false);
                    setTypedConfirmation('');
                  }}
                  variant="secondary"
                  style={styles.modalCancelButton}
                />
                <Button
                  title="Reset Data"
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
                <Text style={styles.modalTitle}>Delete Account?</Text>

                <Text style={styles.modalWarningText}>
                  Your account enters a <Text style={{ fontWeight: 'bold' }}>30-day Deletion Recovery Window</Text>. Sign in again during this window to cancel the deletion.
                </Text>

                <View style={styles.bulletsContainer}>
                  <Text style={styles.bulletItem}>• Stitch Coin and AI Credit balances</Text>
                  <Text style={styles.bulletItem}>• All Pattern Unlocks</Text>
                  <Text style={styles.bulletItem}>• AI Artwork and Personal Patterns</Text>
                  <Text style={styles.bulletItem}>• Synchronized progress and Likes</Text>
                </View>

                <Text style={styles.modalWarningText}>
                  At the end of the recovery window, these are erased or forfeited with no refund or transfer. Published Community Patterns are withdrawn from the catalog, attribution becomes <Text style={{ fontWeight: 'bold' }}>Deleted Creator</Text>, and your username stays permanently reserved.
                </Text>

                {membership?.active && (
                  <View style={styles.membershipDeletionWarning}>
                    <Text style={[styles.modalWarningText, { color: Theme.colors.error, fontWeight: Theme.typography.weights.medium }]}>
                      Your Premium Membership may keep billing after account deletion. Deletion does not cancel it; manage it separately before continuing if you want billing to stop.
                    </Text>
                    {Platform.OS === 'ios' && (
                      <Button
                        title="Manage Apple Subscription"
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
                    title="Cancel"
                    onPress={() => setDeleteModalVisible(false)}
                    variant="secondary"
                    style={styles.modalCancelButton}
                  />
                  <Button
                    title="Continue"
                    onPress={() => setDeletionStage(2)}
                    style={{ backgroundColor: Theme.colors.error }}
                    textStyle={{ color: Theme.colors.textLight }}
                  />
                </View>
              </View>
            ) : (
              <View>
                <Text style={styles.modalTitle}>Confirm Deletion</Text>

                <Text style={styles.modalWarningText}>
                  To confirm that you want to delete your account, type <Text style={{ fontWeight: 'bold' }}>DELETE</Text> in the box below:
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
                    <Text style={styles.modalLoadingText}>Submitting deletion request...</Text>
                  </View>
                ) : (
                  <View style={styles.modalButtonsRow}>
                    <Button
                      title="Back"
                      onPress={() => setDeletionStage(1)}
                      variant="secondary"
                      style={styles.modalCancelButton}
                    />
                    <Button
                      title="Confirm"
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
            <Text style={styles.modalTitle}>Verify Your Identity</Text>
            <Text style={styles.modalWarningText}>For security, verify with a sign-in method already linked to this account. Deletion resumes automatically after verification.</Text>

            {reauthError && <Text style={styles.reauthErrorText}>{reauthError}</Text>}

            {reauthLoading && !reauthCodeSent ? (
              <View style={styles.modalLoadingContainer}>
                <ActivityIndicator size="small" color={Theme.colors.accentRose} />
                <Text style={styles.modalLoadingText}>Loading sign-in methods...</Text>
              </View>
            ) : reauthCodeSent ? (
              <View>
                <Text style={styles.confirmationInstruction}>Enter the 6-digit code sent to {reauthEmail}.</Text>
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
                <Button title="Verify and Delete" onPress={handleVerifyReauthenticationCode} disabled={reauthCode.length !== 6 || reauthLoading} loading={reauthLoading} />
              </View>
            ) : (
              <View style={styles.reauthProviders}>
                {reauthIdentities.map((identity) => (
                  <Button
                    key={`${identity.provider}:${identity.email ?? ''}`}
                    title={identity.provider === 'email' ? `Email ${identity.email ?? ''}`.trim() : `Continue with ${identity.provider === 'apple' ? 'Apple' : 'Google'}`}
                    onPress={() => identity.provider === 'email' ? void handleEmailReauthentication(identity) : void handleSocialReauthentication(identity.provider)}
                    disabled={reauthProvider !== null || reauthLoading}
                    loading={reauthProvider === identity.provider}
                    variant="secondary"
                  />
                ))}
                {reauthIdentities.length === 0 && !reauthError && (
                  <Text style={styles.reauthErrorText}>No linked sign-in method is available. Contact support before retrying deletion.</Text>
                )}
              </View>
            )}

            <View style={styles.reauthFooter}>
              {reauthError && !reauthCodeSent && (
                <Button title="Retry" onPress={() => void openReauthentication()} variant="secondary" disabled={reauthLoading} />
              )}
              <Button title="Cancel" onPress={() => setReauthVisible(false)} variant="secondary" disabled={reauthLoading || reauthProvider !== null} />
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
});
