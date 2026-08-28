import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card } from './Card';
import { Button } from './Button';
import { Theme } from '@/theme/theme';
import { useIdentityStore } from '@/identity/guestIdentity';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

/**
 * Settings block for the Registered Account. Shows a sign-in entry point for
 * guests and private provider details plus sign-out for accounts.
 * Sign-out locks the Local Identity Namespace without deleting unsynchronized
 * data (see identity `logout`), so the same account reopens it on next sign-in.
 */
export function AccountSection() {
  const { t } = useTranslation('settings');
  const { isAccount, accountEmail, accountProvider, isOfflinePending, requiresSignIn, logout } = useIdentityStore();
  const [isSigningOut, setIsSigningOut] = useState<boolean>(false);

  const providerLabel = (provider: 'apple' | 'email' | 'google' | null): string => {
    if (provider === 'apple') return t('account.providerAppleAccount');
    if (provider === 'google') return t('account.providerGoogleAccount');
    return t('account.providerGenericAccount');
  };

  const handleSignOut = () => {
    Alert.alert(
      t('account.signOutConfirmTitle'),
      t('account.signOutConfirmMessage'),
      [
        { text: t('actions.cancel'), style: 'cancel' },
        {
          text: t('account.signOutConfirmAction'),
          style: 'destructive',
          onPress: async () => {
            setIsSigningOut(true);
            try {
              await logout();
            } catch {
              Alert.alert(
                t('account.signOutFailedTitle'),
                t('account.signOutFailedGeneric'),
              );
            } finally {
              setIsSigningOut(false);
            }
          },
        },
      ],
    );
  };

  return (
    <View>
      <Text style={styles.sectionTitle}>{t('account.sectionTitle')}</Text>
      <Card style={styles.card}>
        {!isAccount ? (
          <View style={styles.settingRow}>
            <View style={styles.textContainer}>
              <Text style={styles.settingTitle}>{requiresSignIn ? t('account.signInRequiredTitle') : t('account.notSignedInTitle')}</Text>
              <Text style={styles.settingDescription}>
                {t('account.notSignedInDescription')}
              </Text>
            </View>
            <Button
              title={t('account.signIn')}
              variant="primary"
              onPress={() => router.push('/(tabs)/(settings)/sign-in')}
              style={styles.signInButton}
            />
          </View>
        ) : (
          <View>
            <View style={styles.emailRow}>
              <Ionicons
                name={
                  accountProvider === 'google'
                    ? 'logo-google'
                    : accountProvider === 'apple'
                      ? 'logo-apple'
                      : 'mail-outline'
                }
                size={20}
                color={Theme.colors.textSecondary}
              />
              <Text style={styles.emailText}>
                {accountEmail ?? providerLabel(accountProvider)}
              </Text>
            </View>
            {isOfflinePending && (
              <Text style={styles.reconnectingText}>{t('account.reconnecting')}</Text>
            )}
            <View style={styles.signOutRow}>
              <Pressable
                onPress={handleSignOut}
                disabled={isSigningOut}
                style={({ pressed }) => [
                  styles.signOutPressable,
                  pressed && { opacity: 0.7 },
                ]}
              >
                {isSigningOut ? (
                  <ActivityIndicator
                    size="small"
                    color={Theme.colors.error}
                    style={styles.spinner}
                  />
                ) : (
                  <Text style={styles.signOutText}>{t('account.signOut')}</Text>
                )}
              </Pressable>
            </View>
          </View>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
    marginTop: Theme.spacing.lg,
    marginBottom: Theme.spacing.sm,
  },
  card: {
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.lg,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    padding: Theme.spacing.lg,
  },
  settingRow: {
    flexDirection: 'column',
    gap: Theme.spacing.md,
  },
  textContainer: {
    flexDirection: 'column',
    gap: Theme.spacing.xs,
  },
  settingTitle: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textPrimary,
  },
  settingDescription: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    lineHeight: 18,
  },
  signInButton: {
    marginTop: Theme.spacing.xs,
  },
  emailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.sm,
    marginBottom: Theme.spacing.md,
  },
  emailText: {
    fontSize: Theme.typography.sizes.md,
    color: Theme.colors.textPrimary,
    fontWeight: Theme.typography.weights.medium,
  },
  signOutRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  signOutPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Theme.spacing.xs,
  },
  signOutText: {
    color: Theme.colors.error,
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.semibold,
  },
  spinner: {
    marginRight: Theme.spacing.xs,
  },
  reconnectingText: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.sm,
    marginBottom: Theme.spacing.sm,
  },
});
