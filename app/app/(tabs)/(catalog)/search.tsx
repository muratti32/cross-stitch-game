import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Screen, Card, Button, EmptyState, PatternImage, SourceLanguageBadge } from '@/components';
import { Theme } from '@/theme/theme';
import { useTabBarSpace } from '@/theme/tabBar';
import {
  absolutePreviewUrl,
  absoluteThumbnailUrls,
  presentCatalogError,
  useCatalogSearch,
} from '@/api/catalog';
import { Ionicons } from '@expo/vector-icons';
import { useLocalLikes } from '@/api/social';
import { useIdentityStore } from '@/identity/guestIdentity';

const DEBOUNCE_MS = 300;

export default function SearchScreen() {
  const { t } = useTranslation('catalog');
  const router = useRouter();
  const tabBarSpace = useTabBarSpace();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const handle = setTimeout(() => setQuery(input), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [input]);

  const search = useCatalogSearch(query);
  const active = query.trim().length >= 2;
  const { data: localLikes } = useLocalLikes();
  const { isAccount } = useIdentityStore();
  // Search is an online-only surface (no offline cache, #160): a genuine
  // backend failure (#159) gets the neutral "couldn't load" title plus its
  // reason-coded or generic-plus-Support-Reference message, never this
  // screen's own connectivity-specific "needs a connection" title - that
  // framing is reserved for an actual connectivity failure.
  const searchError = presentCatalogError(search.error, {
    genericTitle: t('common.sectionError.title'),
    title: t('search.error.title'),
    body: t('search.error.body'),
  });

  return (
    <Screen clearsTabBar={false}>
      <View style={styles.headerRow}>
        <Button
          variant="secondary"
          title={t('common.back')}
          onPress={() => router.back()}
          style={styles.backButton}
        />
        <TextInput
          style={styles.input}
          placeholder={t('common.searchPlaceholder')}
          placeholderTextColor={Theme.colors.textSecondary}
          value={input}
          onChangeText={setInput}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={t('search.inputAccessibilityLabel')}
        />
      </View>

      {!active ? (
        <View style={styles.center}>
          <EmptyState
            icon="search-outline"
            title={t('search.inactive.title')}
            body={t('search.inactive.body')}
          />
        </View>
      ) : search.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Theme.colors.accentTeal} />
        </View>
      ) : search.isError ? (
        <View style={styles.center}>
          <EmptyState
            icon="cloud-offline-outline"
            title={searchError.title}
            body={searchError.body}
            actionLabel={t('common.sectionError.retry')}
            onAction={() => search.refetch()}
            actionVariant="secondary"
          />
        </View>
      ) : (search.data?.length ?? 0) === 0 ? (
        <View style={styles.center}>
          <EmptyState
            icon="color-palette-outline"
            title={t('search.noResults.title')}
            body={t('search.noResults.body', { query: query.trim() })}
          />
        </View>
      ) : (
        <FlatList
          data={search.data}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: tabBarSpace }]}
          renderItem={({ item }) => {
            const isLiked = isAccount ? item.viewerLiked : !!localLikes?.[item.id];
            return (
              <Card
                style={styles.resultRow}
                onPress={() => router.push(`/(tabs)/(catalog)/${item.id}`)}
              >
                <PatternImage
                  assets={{
                    thumbnailUrls: absoluteThumbnailUrls(item.thumbnailUrls),
                    previewUrl: absolutePreviewUrl(item.previewUrl),
                  }}
                  variant="browsing"
                  style={styles.resultImage}
                />
                <View style={styles.resultDetails}>
                  <View style={styles.resultRowHeader}>
                    <Text style={styles.resultTitle} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <View style={styles.cardLikesRow}>
                      <Ionicons
                        name={isLiked ? 'heart' : 'heart-outline'}
                        size={12}
                        color={isLiked ? Theme.colors.error : Theme.colors.textSecondary}
                      />
                      <Text style={styles.cardLikesText}>{item.likeCount}</Text>
                    </View>
                  </View>
                  <SourceLanguageBadge
                    sourceLanguage={item.sourceLanguage}
                    style={styles.sourceLanguageBadge}
                  />
                  <Text style={styles.resultMeta}>
                    {t('common.patternMeta.creatorDimensions', {
                      creatorName: item.creatorName,
                      width: item.width,
                      height: item.height,
                    })}
                  </Text>
                  <View style={styles.resultTags}>
                    {item.tags.slice(0, 3).map((tag) => (
                      <Text key={tag.code} style={styles.resultTag}>
                        #{tag.label}
                      </Text>
                    ))}
                  </View>
                </View>
              </Card>
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Theme.spacing.lg,
    paddingTop: Theme.spacing.md,
    paddingBottom: Theme.spacing.sm,
    gap: Theme.spacing.sm,
  },
  backButton: {
    paddingHorizontal: Theme.spacing.md,
    height: 36,
  },
  input: {
    flex: 1,
    height: 44,
    paddingHorizontal: Theme.spacing.lg,
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.full,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textPrimary,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Theme.spacing.lg,
  },
  listContent: {
    paddingHorizontal: Theme.spacing.lg,
    paddingBottom: Theme.spacing.xxl,
  },
  resultRow: {
    flexDirection: 'row',
    padding: Theme.spacing.sm,
    marginBottom: Theme.spacing.sm,
  },
  resultImage: {
    width: 72,
    height: 72,
    borderRadius: Theme.radii.md,
    backgroundColor: Theme.colors.background,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  resultDetails: {
    flex: 1,
    marginLeft: Theme.spacing.md,
    justifyContent: 'center',
  },
  resultTitle: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textPrimary,
  },
  sourceLanguageBadge: {
    marginTop: Theme.spacing.xs,
  },
  resultMeta: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    marginTop: 2,
  },
  resultTags: {
    flexDirection: 'row',
    gap: Theme.spacing.sm,
    marginTop: Theme.spacing.xs,
  },
  resultTag: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.accentTeal,
  },
  resultRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
  cardLikesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cardLikesText: {
    fontSize: 11,
    color: Theme.colors.textSecondary,
  },
});
