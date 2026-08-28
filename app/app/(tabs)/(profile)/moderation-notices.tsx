import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { useModerationNotices } from '@/api/moderationNotices';
import { Card, EmptyState, Screen } from '@/components';
import { useIdentityStore } from '@/identity/guestIdentity';
import { formatDate } from '@/i18n';
import { Theme } from '@/theme/theme';

export default function ModerationNoticesScreen() {
  const { t, i18n: i18nInstance } = useTranslation('profile');
  const locale = i18nInstance.language;
  const accountId = useIdentityStore((state) => state.accountId);
  const isAccount = useIdentityStore((state) => state.isAccount);
  const query = useModerationNotices(accountId, isAccount);

  return (
    <Screen style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityLabel={t('common.goBackAccessibilityLabel')} hitSlop={12} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color={Theme.colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>{t('moderationNotices.title')}</Text>
        <View style={styles.headerSpacer} />
      </View>

      {!isAccount ? (
        <EmptyState
          icon="person-circle-outline"
          title={t('moderationNotices.signInTitle')}
          body={t('moderationNotices.signInBody')}
          actionLabel={t('moderationNotices.signInAction')}
          onAction={() => router.push('/(tabs)/(settings)/sign-in')}
          actionVariant="rose"
        />
      ) : query.isPending ? (
        <ActivityIndicator style={styles.loader} color={Theme.colors.accentRose} />
      ) : query.isError ? (
        <EmptyState
          icon="cloud-offline-outline"
          title={t('moderationNotices.unavailableTitle')}
          body={query.error instanceof Error ? query.error.message : t('moderationNotices.unavailableDefault')}
          actionLabel={t('common.tryAgain')}
          onAction={() => void query.refetch()}
          actionVariant="rose"
        />
      ) : (query.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon="shield-checkmark-outline"
          title={t('moderationNotices.emptyTitle')}
          body={t('moderationNotices.emptyBody')}
          actionLabel={t('moderationNotices.emptyAction')}
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
              <View style={styles.titleRow}>
                <Ionicons name="shield-outline" size={20} color={Theme.colors.accentHoney} />
                <View style={styles.titleCopy}>
                  <Text style={styles.title}>{item.patternTitle}</Text>
                  <Text style={styles.meta}>
                    {t('moderationNotices.meta', {
                      date: formatDate(new Date(item.createdAt), locale),
                      noticeType: t(`moderationNotices.noticeTypes.${item.noticeType}`),
                    })}
                  </Text>
                </View>
              </View>
              {/* #165: `reason` is backend-authored moderation prose, the
                  same verbatim-inside-localized-framing pattern ADR-0051
                  uses for a Catalog Rejection Reason's moderator note -
                  the app cannot map arbitrary moderator/backend sentences
                  to translation keys. */}
              <Text style={styles.reason}>{item.reason}</Text>
              <Text style={styles.help}>{t(`moderationNotices.noticeHelp.${item.noticeType}`)}</Text>
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
  loader: { marginTop: Theme.spacing.xxl },
  list: { gap: Theme.spacing.md, paddingBottom: Theme.spacing.xxl },
  card: { gap: Theme.spacing.md },
  titleRow: { alignItems: 'flex-start', flexDirection: 'row', gap: Theme.spacing.sm },
  titleCopy: { flex: 1, gap: Theme.spacing.xs },
  title: { color: Theme.colors.textPrimary, fontSize: Theme.typography.sizes.md, fontWeight: Theme.typography.weights.bold },
  meta: { color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.xs },
  reason: { color: Theme.colors.textPrimary, fontSize: Theme.typography.sizes.sm, lineHeight: 21 },
  help: { color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.sm, lineHeight: 20 },
});
