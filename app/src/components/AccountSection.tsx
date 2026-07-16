import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator, Alert } from 'react-native';
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
  const { isAccount, accountEmail, accountProvider, logout } = useIdentityStore();
  const [isSigningOut, setIsSigningOut] = useState<boolean>(false);

  const handleSignOut = () => {
    Alert.alert(
      'Sign out?',
      'Your unsynchronized progress stays on this device and reopens when you sign back in.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            setIsSigningOut(true);
            try {
              await logout();
            } catch (e) {
              Alert.alert(
                'Sign out failed',
                e instanceof Error ? e.message : 'Please try again.',
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
      <Text style={styles.sectionTitle}>Account</Text>
      <Card style={styles.card}>
        {!isAccount ? (
          <View style={styles.settingRow}>
            <View style={styles.textContainer}>
              <Text style={styles.settingTitle}>Not signed in</Text>
              <Text style={styles.settingDescription}>
                Sign in to sync progress across devices.
              </Text>
            </View>
            <Button
              title="Sign in"
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
                  <Text style={styles.signOutText}>Sign out</Text>
                )}
              </Pressable>
            </View>
          </View>
        )}
      </Card>
    </View>
  );
}

function providerLabel(provider: 'apple' | 'email' | 'google' | null): string {
  if (provider === 'apple') return 'Apple account';
  if (provider === 'google') return 'Google account';
  return 'Registered account';
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
});
