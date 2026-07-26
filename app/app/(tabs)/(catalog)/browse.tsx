import React from 'react';
import { StyleSheet, View, Text, FlatList, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen, Card, Button, EmptyState, PatternImage } from '@/components';
import { Theme } from '@/theme/theme';
import { useTabBarSpace } from '@/theme/tabBar';
import {
  CatalogPatternItem,
  absolutePreviewUrl,
  absoluteThumbnailUrls,
  usePatternsBrowse,
} from '@/api/catalog';
import { Ionicons } from '@expo/vector-icons';
import { useLocalLikes } from '@/api/social';
import { useIdentityStore } from '@/identity/guestIdentity';

export default function BrowseScreen() {
  const { category, tag, title } = useLocalSearchParams<{
    category?: string;
    tag?: string;
    title?: string;
  }>();
  const router = useRouter();
  const tabBarSpace = useTabBarSpace();
  const browse = usePatternsBrowse({ category, tag });
  const { data: localLikes } = useLocalLikes();
  const { isAccount } = useIdentityStore();

  const items: CatalogPatternItem[] =
    browse.data?.pages.flatMap((page) => page.data.items) ?? [];
  const fromCache = browse.data?.pages[0]?.fromCache === true;

  return (
    <Screen clearsTabBar={false}>
      <View style={styles.headerRow}>
        <Button
          variant="secondary"
          title="← Back"
          onPress={() => router.back()}
          style={styles.backButton}
        />
        <Text style={styles.title} numberOfLines={1}>
          {title ?? 'Browse'}
        </Text>
      </View>

      {fromCache && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>
            Offline — catalog may be out of date
          </Text>
        </View>
      )}

      {browse.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Theme.colors.accentTeal} />
        </View>
      ) : browse.isError ? (
        <View style={styles.center}>
          <EmptyState
            icon="cloud-offline-outline"
            title="Couldn't Load"
            body="This catalog page could not be reached and nothing is cached yet."
            actionLabel="Try Again"
            onAction={() => browse.refetch()}
            actionVariant="secondary"
          />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <EmptyState
            icon="color-palette-outline"
            title="Nothing Here Yet"
            body="No patterns match this selection yet. New designs arrive regularly."
          />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={[styles.gridContent, { paddingBottom: tabBarSpace }]}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (browse.hasNextPage && !browse.isFetchingNextPage) {
              void browse.fetchNextPage();
            }
          }}
          ListFooterComponent={
            browse.isFetchingNextPage ? (
              <ActivityIndicator
                size="small"
                color={Theme.colors.accentTeal}
                style={styles.footerSpinner}
              />
            ) : null
          }
          renderItem={({ item }) => {
            const isLiked = isAccount ? item.viewerLiked : !!localLikes?.[item.id];
            return (
              <Card
                style={styles.gridCard}
                onPress={() => router.push(`/(tabs)/(catalog)/${item.id}`)}
              >
                <PatternImage
                  assets={{
                    thumbnailUrls: absoluteThumbnailUrls(item.thumbnailUrls),
                    previewUrl: absolutePreviewUrl(item.previewUrl),
                  }}
                  variant="browsing"
                  style={styles.gridImage}
                />
                <Text style={styles.gridTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.gridMeta}>
                  {item.width}×{item.height} • {item.paletteSize} cols
                </Text>
                <View style={styles.cardLikesRow}>
                  <Ionicons
                    name={isLiked ? 'heart' : 'heart-outline'}
                    size={12}
                    color={isLiked ? Theme.colors.error : Theme.colors.textSecondary}
                  />
                  <Text style={styles.cardLikesText}>{item.likeCount}</Text>
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
    gap: Theme.spacing.md,
  },
  backButton: {
    paddingHorizontal: Theme.spacing.md,
    height: 36,
  },
  title: {
    flex: 1,
    fontSize: Theme.typography.sizes.xl,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  offlineBanner: {
    marginHorizontal: Theme.spacing.lg,
    marginBottom: Theme.spacing.sm,
    paddingVertical: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.md,
    backgroundColor: Theme.colors.overlayPressed,
    borderRadius: Theme.radii.md,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  offlineBannerText: {
    fontSize: Theme.typography.sizes.xs,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textSecondary,
    textAlign: 'center',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Theme.spacing.lg,
  },
  gridContent: {
    paddingHorizontal: Theme.spacing.lg,
    paddingBottom: Theme.spacing.xxl,
  },
  gridRow: {
    gap: Theme.spacing.md,
    marginBottom: Theme.spacing.md,
  },
  gridCard: {
    flex: 1,
    padding: Theme.spacing.sm,
  },
  gridImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: Theme.radii.md,
    backgroundColor: Theme.colors.background,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  gridTitle: {
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textPrimary,
    marginTop: Theme.spacing.sm,
  },
  gridMeta: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    marginTop: 2,
  },
  footerSpinner: {
    marginVertical: Theme.spacing.md,
  },
  cardLikesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  cardLikesText: {
    fontSize: 11,
    color: Theme.colors.textSecondary,
  },
});
