import React from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useCreatorBlocks, useUnblockCreator } from '@/api/social';
import { isServerApiError, localizeServerError } from '@/api/localizeServerError';
import { Button, Card, EmptyState, Screen } from '@/components';
import { useIdentityStore } from '@/identity/guestIdentity';
import { Theme } from '@/theme/theme';

export default function BlockedCreatorsScreen() {
  const isAccount = useIdentityStore((state) => state.isAccount);
  const query = useCreatorBlocks();
  const unblockMutation = useUnblockCreator();

  // Handle guest principal state
  if (!isAccount) {
    return (
      <Screen style={styles.screen}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="Go back" hitSlop={12} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={26} color={Theme.colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Blocked Creators</Text>
          <View style={styles.headerSpacer} />
        </View>
        <EmptyState
          icon="person-circle-outline"
          title="Registered Account Required"
          body="Sign in before managing your blocked creators list."
          actionLabel="Sign In"
          onAction={() => router.push('/(tabs)/(settings)/sign-in')}
          actionVariant="rose"
        />
      </Screen>
    );
  }

  const handleUnblock = (id: string, name: string) => {
    Alert.alert(
      'Unblock Creator',
      `Are you sure you want to unblock ${name}? Their patterns will reappear in your search and browse results.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: () => {
            unblockMutation.mutate(id, {
              onSuccess: () => Alert.alert('Success', `${name} has been unblocked.`),
              onError: (err: unknown) => {
                // #159: SocialApiError's server-supplied `message` never
                // reaches the player; its `reason` maps to localized text.
                const msg = isServerApiError(err) ? localizeServerError(err) : err instanceof Error ? err.message : 'Unknown error';
                Alert.alert('Error', `Failed to unblock creator: ${msg}`);
              },
            });
          },
        },
      ]
    );
  };

  return (
    <Screen style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="Go back" hitSlop={12} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color={Theme.colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Blocked Creators</Text>
        <View style={styles.headerSpacer} />
      </View>

      <Text style={styles.infoText}>
        Blocking is private and reversible. It hides the creator's community patterns from your catalog views, search, and discovery lists. This is not a report or a content takedown.
      </Text>

      {query.isPending ? (
        <ActivityIndicator style={styles.loader} color={Theme.colors.accentRose} />
      ) : query.isError ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="List Unavailable"
          body={
            query.error
              ? isServerApiError(query.error)
                ? localizeServerError(query.error)
                : query.error.message
              : 'Could not load blocked creators.'
          }
          actionLabel="Try Again"
          onAction={() => void query.refetch()}
          actionVariant="rose"
        />
      ) : (query.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon="shield-checkmark-outline"
          title="No Blocked Creators"
          body="You haven't blocked anyone. You can block a creator from any of their pattern detail pages."
          actionLabel="Back to Settings"
          onAction={() => router.back()}
          actionVariant="sage"
        />
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={query.data}
          keyExtractor={(item) => item.id}
          onRefresh={() => void query.refetch()}
          refreshing={query.isRefetching}
          renderItem={({ item }) => (
            <Card style={styles.card}>
              <View style={styles.creatorInfo}>
                <Text style={styles.displayName}>{item.displayName}</Text>
                <Text style={styles.username}>@{item.username}</Text>
              </View>
              <Button
                title="Unblock"
                variant="secondary"
                loading={unblockMutation.isPending && unblockMutation.variables === item.id}
                onPress={() => handleUnblock(item.id, item.displayName)}
                style={styles.unblockButton}
              />
            </Card>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingHorizontal: Theme.spacing.lg },
  header: { alignItems: 'center', flexDirection: 'row', paddingVertical: Theme.spacing.lg },
  headerTitle: { color: Theme.colors.textPrimary, flex: 1, fontSize: Theme.typography.sizes.xl, fontWeight: Theme.typography.weights.bold, textAlign: 'center' },
  headerSpacer: { width: 26 },
  infoText: {
    color: Theme.colors.textSecondary,
    fontSize: Theme.typography.sizes.xs,
    lineHeight: 18,
    marginBottom: Theme.spacing.lg,
    backgroundColor: '#FCFAF7',
    padding: Theme.spacing.md,
    borderRadius: Theme.radii.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  loader: { marginTop: Theme.spacing.xxl },
  list: { gap: Theme.spacing.md, paddingBottom: Theme.spacing.xxl },
  card: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Theme.spacing.md },
  creatorInfo: { flex: 1 },
  displayName: { color: Theme.colors.textPrimary, fontSize: Theme.typography.sizes.sm, fontWeight: Theme.typography.weights.bold },
  username: { color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.xs, marginTop: 2 },
  unblockButton: { height: 36, paddingHorizontal: Theme.spacing.md },
});
