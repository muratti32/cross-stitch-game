import React from 'react';
import { StyleSheet, View, Text, Switch, ActivityIndicator, Pressable, Alert, Linking, Modal, TextInput } from 'react-native';
import { Screen, Card, Button, AccountSection } from '@/components';
import { Theme } from '@/theme/theme';
import { useGameplayStore } from '@/store';
import { useHealthCheck } from '@/hooks/useHealthCheck';
import { Config } from '@/config';
import { Ionicons } from '@expo/vector-icons';
import { setHandedness as setHandednessDb } from '@/local-db';
import { useBackendSession } from '@/hooks/useBackendSession';
import { shortenGuestId } from '@/identity/identityLogic';
import { resetGuestData, removeLocalData } from '@/identity/guestIdentity';

export default function SettingsScreen() {
  const { showGridLines, toggleGridLines, handedness, setHandedness } = useGameplayStore();
  const { data: health, isLoading, error, refetch, isRefetching } = useHealthCheck();
  const { data: sessionData, isLoading: sessionLoading, error: sessionError } = useBackendSession();

  const [resetModalVisible, setResetModalVisible] = React.useState(false);
  const [typedConfirmation, setTypedConfirmation] = React.useState('');
  const [isResetting, setIsResetting] = React.useState(false);
  const [isRemovingLocal, setIsRemovingLocal] = React.useState(false);

  const isOffline = !isLoading && (!!error || !health || health.status !== 'ok');

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

  const handleLinkPress = (title: string, url?: string) => {
    if (url) {
      Linking.openURL(url).catch(() => {
        Alert.alert('Error', `Could not open link: ${url}`);
      });
    } else {
      Alert.alert(title, 'This page will be available before release.');
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
      </>
      )}

      {/* Registered Account (email sign-in / sign-out) */}
      <AccountSection />

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

      {/* Data Section */}
      <Text style={styles.sectionTitle}>Data</Text>
      <Card style={styles.card}>
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
          </View>
          <Ionicons
            name="trash-outline"
            size={20}
            color={isOffline ? Theme.colors.disabledText : Theme.colors.error}
          />
        </Pressable>

        <View style={styles.rowDivider} />

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
          onPress={() => handleLinkPress('Privacy Policy')}
          style={({ pressed }) => [styles.linkRow, pressed && styles.linkPressed]}
        >
          <Text style={styles.linkText}>Privacy Policy</Text>
          <Ionicons name="chevron-forward" size={16} color={Theme.colors.textSecondary} />
        </Pressable>
        <View style={styles.rowDivider} />
        
        <Pressable
          onPress={() => handleLinkPress('Terms of Service')}
          style={({ pressed }) => [styles.linkRow, pressed && styles.linkPressed]}
        >
          <Text style={styles.linkText}>Terms of Service</Text>
          <Ionicons name="chevron-forward" size={16} color={Theme.colors.textSecondary} />
        </Pressable>
        <View style={styles.rowDivider} />

        <Pressable
          onPress={() => handleLinkPress('Contact Support')}
          style={({ pressed }) => [styles.linkRow, pressed && styles.linkPressed]}
        >
          <Text style={styles.linkText}>Contact Support</Text>
          <Ionicons name="chevron-forward" size={16} color={Theme.colors.textSecondary} />
        </Pressable>
      </Card>

      {/* App details card */}
      <View style={styles.appDetails}>
        <Text style={styles.appDetailsText}>Stitch Wish — Cozy Pixel-Art Needlecraft</Text>
        <Text style={styles.appDetailsVersion}>Version 1.0.0</Text>
        {__DEV__ && (
          <>
            <Text style={styles.appDetailsVersion}>Expo SDK 54</Text>
            <Text style={styles.appDetailsIdentifier}>Package: com.avk.stitchwish</Text>
            <Text style={styles.appDetailsScheme}>Scheme: stitchwish://</Text>
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: Theme.spacing.xl,
    paddingHorizontal: Theme.spacing.lg,
    paddingBottom: Theme.spacing.xxl,
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
});
