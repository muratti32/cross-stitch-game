import React, { useCallback } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';

import { useLikedPatterns } from '@/api/social';
import { Card, EmptyState, Screen, PatternImage } from '@/components';
import { useIdentityStore } from '@/identity/guestIdentity';
import { Theme } from '@/theme/theme';
import { absolutePreviewUrl, absoluteThumbnailUrls } from '@/api/catalog';

export default function LikedPatternsScreen() {
  const isAccount = useIdentityStore((state) => state.isAccount);
  const query = useLikedPatterns('en');

  useFocusEffect(
    useCallback(() => {
      if (isAccount) {
        void query.refetch();
      }
    }, [isAccount, query.refetch]),
  );

  // Handle guest principal state
  if (!isAccount) {
    return (
      <Screen style={styles.screen}>
        <View style={styles.header}>
          <Pressable accessibilityLabel="Go back" hitSlop={12} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={26} color={Theme.colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Liked Patterns</Text>
          <View style={styles.headerSpacer} />
        </View>
        <EmptyState
          icon="person-circle-outline"
          title="Registered Account Required"
          body="Sign in before viewing your private Liked Patterns collection."
          actionLabel="Sign In"
          onAction={() => router.push('/(tabs)/(settings)/sign-in')}
          actionVariant="rose"
        />
      </Screen>
    );
  }

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Screen style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="Go back" hitSlop={12} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color={Theme.colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Liked Patterns</Text>
        <View style={styles.headerSpacer} />
      </View>

      {query.isPending ? (
        <ActivityIndicator style={styles.loader} color={Theme.colors.accentRose} />
      ) : query.isError ? (
        <EmptyState
          icon="cloud-offline-outline"
          title="Liked Patterns Unavailable"
          body={query.error instanceof Error ? query.error.message : 'Could not load liked patterns.'}
          actionLabel="Try Again"
          onAction={() => void query.refetch()}
          actionVariant="rose"
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon="heart-outline"
          title="No Liked Patterns"
          body="Browse the pattern catalog and tap the heart icon on any design to save it here."
          actionLabel="Discover Patterns"
          onAction={() => router.navigate('/(tabs)/(catalog)')}
          actionVariant="sage"
        />
      ) : (
        <FlatList
          contentContainerStyle={styles.list}
          data={items}
          keyExtractor={(item) => item.id}
          onRefresh={() => void query.refetch()}
          refreshing={query.isRefetching}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) {
              void query.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={() =>
            query.isFetchingNextPage ? (
              <ActivityIndicator style={styles.footerLoader} color={Theme.colors.accentRose} />
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/(tabs)/(catalog)/${item.id}`)}
              style={({ pressed }) => [pressed && styles.pressedItem]}
            >
              <Card style={styles.card}>
                <PatternImage
                  assets={{
                    thumbnailUrls: absoluteThumbnailUrls(item.thumbnailUrls),
                    previewUrl: absolutePreviewUrl(item.previewUrl),
                  }}
                  variant="browsing"
                  style={styles.preview}
                />
                <View style={styles.info}>
                  <Text numberOfLines={1} style={styles.title}>{item.title}</Text>
                  <Text style={styles.meta}>by {item.creatorName}</Text>
                  <Text style={styles.specs}>
                    {item.width}×{item.height} · {item.paletteSize} colors · {item.categoryCode}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={Theme.colors.textSecondary} />
              </Card>
            </Pressable>
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
  footerLoader: { paddingVertical: Theme.spacing.md },
  list: { gap: Theme.spacing.md, paddingBottom: Theme.spacing.xxl },
  card: { flexDirection: 'row', alignItems: 'center', padding: Theme.spacing.md },
  preview: { borderRadius: Theme.radii.sm, height: 60, width: 60 },
  info: { flex: 1, marginHorizontal: Theme.spacing.md, gap: Theme.spacing.xs },
  title: { color: Theme.colors.textPrimary, fontSize: Theme.typography.sizes.sm, fontWeight: Theme.typography.weights.bold },
  meta: { color: Theme.colors.accentTeal, fontSize: Theme.typography.sizes.xs, fontWeight: Theme.typography.weights.semibold },
  specs: { color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.xs },
  pressedItem: { opacity: 0.75 },
});
