import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';

import {
  CreatorProfileApiError,
  useCreatorProfile,
  useSaveCreatorProfile,
} from '@/api/creatorProfile';
import { Button, Card, EmptyState, Screen } from '@/components';
import { useIdentityStore } from '@/identity/guestIdentity';
import { Theme } from '@/theme/theme';

const ACCEPTED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export default function PublicProfileScreen() {
  const isAccount = useIdentityStore((state) => state.isAccount);
  const accountId = useIdentityStore((state) => state.accountId);
  const profileQuery = useCreatorProfile(accountId, isAccount);
  const saveProfile = useSaveCreatorProfile(accountId);
  const initialized = useRef(false);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [avatar, setAvatar] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [pickingAvatar, setPickingAvatar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const profile = profileQuery.data ?? null;
  const isEditing = profile !== null;

  useEffect(() => {
    if (!profileQuery.isSuccess || initialized.current) return;
    initialized.current = true;
    if (profile !== null) {
      setUsername(profile.username);
      setDisplayName(profile.displayName);
    }
  }, [profile, profileQuery.isSuccess]);

  const normalizedUsername = username.trim().toLowerCase();
  const normalizedDisplayName = displayName.trim().replace(/\s+/g, ' ');
  const validUsername = /^[a-z0-9_]{3,30}$/.test(normalizedUsername);
  const validDisplayName = normalizedDisplayName.length >= 1 && normalizedDisplayName.length <= 50;
  const canSubmit =
    validUsername &&
    validDisplayName &&
    !saveProfile.isPending &&
    !pickingAvatar;

  const pickAvatar = async () => {
    if (pickingAvatar || saveProfile.isPending) return;
    setPickingAvatar(true);
    setError(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError('Photo library access is required to choose a profile photo.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: [1, 1],
        exif: false,
        mediaTypes: ['images'],
        quality: 0.9,
      });
      if (result.canceled) return;
      const selected = result.assets[0];
      if (selected.mimeType !== undefined && !ACCEPTED_AVATAR_TYPES.has(selected.mimeType)) {
        setError('Profile photos must be JPEG, PNG, or WebP.');
        return;
      }
      if (selected.fileSize !== undefined && selected.fileSize > MAX_AVATAR_BYTES) {
        setError('Profile photos must be 5 MB or smaller.');
        return;
      }
      setAvatar(selected);
      setRemoveAvatar(false);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setPickingAvatar(false);
    }
  };

  const clearAvatar = () => {
    setAvatar(null);
    setRemoveAvatar(profile !== null && profile.avatarUrl !== null);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setError(null);
    try {
      await saveProfile.mutateAsync(
        isEditing
          ? {
              avatar: avatar ?? undefined,
              displayName: normalizedDisplayName,
              kind: 'update',
              removeAvatar,
            }
          : {
              avatar: avatar ?? undefined,
              displayName: normalizedDisplayName,
              kind: 'create',
              username: normalizedUsername,
            },
      );
      router.back();
    } catch (caught: unknown) {
      if (caught instanceof CreatorProfileApiError) {
        setError(caught.reason ?? caught.message);
      } else {
        setError(caught instanceof Error ? caught.message : 'Could not save your public profile');
      }
    }
  };

  const previewUri = avatar?.uri ?? (removeAvatar ? null : profile?.avatarUrl ?? null);

  return (
    <Screen scrollable contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Go back"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={24} color={Theme.colors.textPrimary} />
        </Pressable>
        <Text style={styles.title}>{isEditing ? 'Edit Public Profile' : 'Create Public Profile'}</Text>
        <View style={styles.headerSpacer} />
      </View>

      {!isAccount ? (
        <EmptyState
          actionLabel="Sign in"
          actionVariant="rose"
          body="A Registered Account is required to create a public creator identity."
          icon="person-circle-outline"
          onAction={() => router.replace('/(tabs)/(settings)/sign-in')}
          title="Sign in required"
        />
      ) : profileQuery.isLoading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={Theme.colors.accentRose} />
        </View>
      ) : profileQuery.isError ? (
        <EmptyState
          actionLabel="Try again"
          actionVariant="rose"
          body="Your public profile could not be loaded. Check your connection and try again."
          icon="cloud-offline-outline"
          onAction={() => void profileQuery.refetch()}
          title="Profile unavailable"
        />
      ) : (
        <Card style={styles.card}>
          <Text style={styles.intro}>
            This name and photo are visible with your community patterns. Your email and sign-in provider stay private.
          </Text>

          <View style={styles.avatarSection}>
            <View style={styles.avatarFrame}>
              {previewUri === null ? (
                <Ionicons name="person" size={48} color={Theme.colors.accentRose} />
              ) : (
                <Image source={{ uri: previewUri }} style={styles.avatarImage} />
              )}
            </View>
            <View style={styles.avatarActions}>
              <Button
                disabled={saveProfile.isPending}
                loading={pickingAvatar}
                onPress={() => void pickAvatar()}
                style={styles.avatarButton}
                title={previewUri === null ? 'Choose photo' : 'Change photo'}
                variant="secondary"
              />
              {previewUri !== null && (
                <Pressable
                  accessibilityRole="button"
                  disabled={saveProfile.isPending}
                  onPress={clearAvatar}
                  style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
                >
                  <Text style={styles.removeButtonText}>Remove</Text>
                </Pressable>
              )}
            </View>
            <Text style={styles.helper}>Optional · JPEG, PNG, or WebP · up to 5 MB</Text>
          </View>

          <Text style={styles.label}>Username</Text>
          <View style={[styles.usernameInputRow, isEditing && styles.lockedInput]}>
            <Text style={styles.atSign}>@</Text>
            <TextInput
              accessibilityLabel="Public username"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isEditing && !saveProfile.isPending}
              maxLength={30}
              onChangeText={(value) => setUsername(value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              placeholder="stitcher_name"
              placeholderTextColor={Theme.colors.textSecondary}
              style={styles.usernameInput}
              value={username}
            />
            {isEditing && <Ionicons name="lock-closed" size={16} color={Theme.colors.textSecondary} />}
          </View>
          <Text style={styles.helper}>
            {isEditing
              ? 'Your username is permanent.'
              : '3–30 lowercase letters, numbers, or underscores. This cannot be changed later.'}
          </Text>

          <Text style={styles.label}>Display name</Text>
          <TextInput
            accessibilityLabel="Public display name"
            autoCapitalize="words"
            editable={!saveProfile.isPending}
            maxLength={50}
            onChangeText={setDisplayName}
            placeholder="Your creator name"
            placeholderTextColor={Theme.colors.textSecondary}
            style={styles.textInput}
            value={displayName}
          />
          <Text style={styles.helper}>You can change this later.</Text>

          <View style={styles.safetyNotice}>
            <Ionicons name="shield-checkmark-outline" size={18} color={Theme.colors.accentTeal} />
            <Text style={styles.safetyText}>
              Names and photos are checked before publication. If a change is rejected, your current public profile stays unchanged.
            </Text>
          </View>

          {error !== null && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={18} color={Theme.colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Button
            disabled={!canSubmit}
            loading={saveProfile.isPending}
            onPress={() => void submit()}
            title={isEditing ? 'Save public profile' : 'Publish public profile'}
            variant="rose"
          />
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Theme.spacing.lg,
    paddingTop: Theme.spacing.sm,
    paddingBottom: Theme.spacing.xxl,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Theme.spacing.lg,
  },
  backButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  headerSpacer: { width: 44 },
  title: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.xl,
    fontWeight: Theme.typography.weights.bold,
  },
  pressed: { opacity: 0.65 },
  loadingState: {
    alignItems: 'center',
    paddingVertical: Theme.spacing.xxl,
  },
  card: {
    gap: Theme.spacing.md,
    padding: Theme.spacing.lg,
  },
  intro: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.sm,
    lineHeight: 20,
  },
  avatarSection: {
    alignItems: 'center',
    marginVertical: Theme.spacing.sm,
  },
  avatarFrame: {
    alignItems: 'center',
    backgroundColor: Theme.colors.background,
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.full,
    borderWidth: 1.5,
    height: 104,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 104,
  },
  avatarImage: { height: '100%', width: '100%' },
  avatarActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Theme.spacing.sm,
    marginTop: Theme.spacing.md,
    marginBottom: Theme.spacing.sm,
  },
  avatarButton: { height: 40 },
  removeButton: { paddingHorizontal: Theme.spacing.sm, paddingVertical: Theme.spacing.md },
  removeButtonText: {
    color: Theme.colors.error,
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.semibold,
  },
  label: {
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.semibold,
    marginTop: Theme.spacing.xs,
  },
  textInput: {
    backgroundColor: Theme.colors.background,
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.md,
    borderWidth: 1,
    color: Theme.colors.textPrimary,
    fontSize: Theme.typography.sizes.md,
    height: 48,
    paddingHorizontal: Theme.spacing.md,
  },
  usernameInputRow: {
    alignItems: 'center',
    backgroundColor: Theme.colors.background,
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    height: 48,
    paddingHorizontal: Theme.spacing.md,
  },
  lockedInput: { opacity: 0.72 },
  atSign: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.md,
  },
  usernameInput: {
    color: Theme.colors.textPrimary,
    flex: 1,
    fontSize: Theme.typography.sizes.md,
    paddingHorizontal: Theme.spacing.xs,
  },
  helper: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.xs,
    lineHeight: 17,
  },
  safetyNotice: {
    alignItems: 'flex-start',
    backgroundColor: Theme.colors.background,
    borderColor: Theme.colors.border,
    borderRadius: Theme.radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Theme.spacing.sm,
    marginVertical: Theme.spacing.sm,
    padding: Theme.spacing.md,
  },
  safetyText: {
    color: Theme.colors.textSecondary,
    flex: 1,
    fontSize: Theme.typography.sizes.xs,
    lineHeight: 18,
  },
  errorBox: {
    alignItems: 'flex-start',
    backgroundColor: Theme.colors.background,
    borderColor: Theme.colors.error,
    borderRadius: Theme.radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Theme.spacing.sm,
    padding: Theme.spacing.md,
  },
  errorText: {
    color: Theme.colors.error,
    flex: 1,
    fontSize: Theme.typography.sizes.sm,
    lineHeight: 20,
  },
});
