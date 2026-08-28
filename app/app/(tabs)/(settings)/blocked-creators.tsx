import React from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useCreatorBlocks, useUnblockCreator } from '@/api/social';
import { isServerApiError, localizeServerError } from '@/api/localizeServerError';
import { Button, Card, EmptyState, Screen } from '@/components';
import { useIdentityStore } from '@/identity/guestIdentity';
import { Theme } from '@/theme/theme';

export default function BlockedCreatorsScreen() {
  const { t } = useTranslation('settings');
  const isAccount = useIdentityStore((state) => state.isAccount);
  const query = useCreatorBlocks();
  const unblockMutation = useUnblockCreator();

  // Handle guest principal state
  if (!isAccount) {
    return (
      <Screen style={styles.screen}>
        <View style={styles.header}>
          <Pressable accessibilityLabel={t('blockedCreators.backAccessibilityLabel')} hitSlop={12} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={26} color={Theme.colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>{t('blockedCreators.title')}</Text>
          <View style={styles.headerSpacer} />
        </View>
        <EmptyState
          icon="person-circle-outline"
          title={t('blockedCreators.signInRequiredTitle')}
          body={t('blockedCreators.signInRequiredBody')}
          actionLabel={t('blockedCreators.signInAction')}
          onAction={() => router.push('/(tabs)/(settings)/sign-in')}
          actionVariant="rose"
        />
      </Screen>
    );
  }

  const handleUnblock = (id: string, name: string) => {
    Alert.alert(
      t('blockedCreators.unblockConfirmTitle'),
      t('blockedCreators.unblockConfirmMessage', { name }),
      [
        { text: t('blockedCreators.cancel'), style: 'cancel' },
        {
          text: t('blockedCreators.unblock'),
          onPress: () => {
            unblockMutation.mutate(id, {
              onSuccess: () => Alert.alert(t('blockedCreators.successTitle'), t('blockedCreators.unblockedMessage', { name })),
              onError: (err: unknown) => {
                // #159: SocialApiError's server-supplied `message` never
                // reaches the player; its `reason` maps to localized text.
                const msg = isServerApiError(err) ? localizeServerError(err) : t('blockedCreators.unblockFailedGeneric');
                Alert.alert(t('blockedCreators.errorTitle'), t('blockedCreators.unblockFailedMessage', { message: msg }));
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
        <Pressable accessibilityLabel={t('blockedCreators.backAccessibilityLabel')} hitSlop={12} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color={Theme.colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('blockedCreators.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <Text style={styles.infoText}>
        {t('blockedCreators.infoText')}
      </Text>

      {query.isPending ? (
        <ActivityIndicator style={styles.loader} color={Theme.colors.accentRose} />
      ) : query.isError ? (
        <EmptyState
          icon="cloud-offline-outline"
          title={t('blockedCreators.listUnavailableTitle')}
          body={
            query.error
              ? isServerApiError(query.error)
                ? localizeServerError(query.error)
                : t('blockedCreators.listUnavailableDefault')
              : t('blockedCreators.listUnavailableDefault')
          }
          actionLabel={t('blockedCreators.tryAgain')}
          onAction={() => void query.refetch()}
          actionVariant="rose"
        />
      ) : (query.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon="shield-checkmark-outline"
          title={t('blockedCreators.emptyTitle')}
          body={t('blockedCreators.emptyBody')}
          actionLabel={t('blockedCreators.backToSettings')}
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
                title={t('blockedCreators.unblock')}
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
