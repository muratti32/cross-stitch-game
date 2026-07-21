import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, Card, Button, EmptyState, CachedImage } from '@/components';
import { Theme } from '@/theme/theme';
import { useTabBarSpace } from '@/theme/tabBar';
import { absolutePreviewUrl, useCatalogSearch } from '@/api/catalog';

const DEBOUNCE_MS = 300;

export default function SearchScreen() {
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

  return (
    <Screen clearsTabBar={false}>
      <View style={styles.headerRow}>
        <Button
          variant="secondary"
          title="← Back"
          onPress={() => router.back()}
          style={styles.backButton}
        />
        <TextInput
          style={styles.input}
          placeholder="Search patterns, creators, tags…"
          placeholderTextColor={Theme.colors.textSecondary}
          value={input}
          onChangeText={setInput}
          autoFocus
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Catalog search input"
        />
      </View>

      {!active ? (
        <View style={styles.center}>
          <EmptyState
            icon="search-outline"
            title="Search the Catalog"
            body="Type at least two characters to search patterns by title, creator, or tag."
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
            title="Search Needs a Connection"
            body="Catalog search is unavailable offline. Cached catalog pages stay browsable from the catalog tab."
            actionLabel="Try Again"
            onAction={() => search.refetch()}
            actionVariant="secondary"
          />
        </View>
      ) : (search.data?.length ?? 0) === 0 ? (
        <View style={styles.center}>
          <EmptyState
            icon="color-palette-outline"
            title="No Matches"
            body={`Nothing in the catalog matches “${query.trim()}” yet.`}
          />
        </View>
      ) : (
        <FlatList
          data={search.data}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.listContent, { paddingBottom: tabBarSpace }]}
          renderItem={({ item }) => (
            <Card
              style={styles.resultRow}
              onPress={() => router.push(`/(tabs)/(catalog)/${item.id}`)}
            >
              <CachedImage
                uri={absolutePreviewUrl(item.originalImageUrl ?? item.previewUrl)}
                style={styles.resultImage}
              />
              <View style={styles.resultDetails}>
                <Text style={styles.resultTitle} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={styles.resultMeta}>
                  {item.creatorName} • {item.width}×{item.height}
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
          )}
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
});
