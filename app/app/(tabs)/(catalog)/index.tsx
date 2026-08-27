import React from 'react';
import { StyleSheet, View, Text, ScrollView, ActivityIndicator, Pressable, RefreshControl } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Screen, EmptyState, SectionHeader, Card, Button, PatternImage, SourceLanguageBadge } from '@/components';
import { Theme } from '@/theme/theme';
import { BUNDLED_PATTERNS } from '@/bundled-patterns';
import { useRouter } from 'expo-router';
import {
  CatalogPatternItem,
  absolutePreviewUrl,
  absoluteThumbnailUrls,
  presentCatalogError,
  useCatalogCategories,
  useCatalogTags,
  useNewPatterns,
  useStaffPicks,
} from '@/api/catalog';
import { Ionicons } from '@expo/vector-icons';
import { useLocalLikes } from '@/api/social';
import { useIdentityStore } from '@/identity/guestIdentity';

export default function CatalogScreen() {
  const { t } = useTranslation('catalog');
  const router = useRouter();
  const staffPicks = useStaffPicks();
  const newPatterns = useNewPatterns();
  const categories = useCatalogCategories();
  const tags = useCatalogTags();
  const [refreshing, setRefreshing] = React.useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        staffPicks.refetch(),
        newPatterns.refetch(),
        categories.refetch(),
        tags.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const servedFromCache =
    staffPicks.data?.fromCache === true ||
    categories.data?.fromCache === true ||
    newPatterns.data?.pages[0]?.fromCache === true;

  const handleSelectPattern = (id: string) => {
    router.push(`/(tabs)/(catalog)/${id}`);
  };

  const newItems: CatalogPatternItem[] =
    newPatterns.data?.pages.flatMap((page) => page.data.items) ?? [];

  return (
    <Screen
      scrollable
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={handleRefresh}
          tintColor={Theme.colors.accentTeal}
          colors={[Theme.colors.accentTeal]}
        />
      }
    >
      <View style={styles.header}>
        <Text style={styles.appName}>Stitch Wish</Text>
        <Text style={styles.subtitle}>{t('index.subtitle')}</Text>
      </View>

      <Pressable
        style={({ pressed }) => [styles.searchBar, pressed && styles.searchBarPressed]}
        onPress={() => router.push('/(tabs)/(catalog)/search')}
        accessibilityRole="search"
        accessibilityLabel={t('index.searchBar.accessibilityLabel')}
      >
        <Text style={styles.searchBarText}>{t('common.searchPlaceholder')}</Text>
      </Pressable>

      {servedFromCache && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>{t('common.offlineBanner')}</Text>
        </View>
      )}

      {/* Bundled Starter Patterns — always available, even offline */}
      <SectionHeader title={t('index.sections.starterPatterns')} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalScroll}
      >
        {BUNDLED_PATTERNS.map((pattern) => (
          <Card
            key={pattern.id}
            style={styles.patternCard}
            onPress={() => handleSelectPattern(pattern.id)}
          >
            <PatternImage
              assets={{}}
              variant="browsing"
              localAsset={pattern.previewAsset}
              localThumbnailAsset={pattern.thumbnailAsset}
              style={styles.patternImage}
            />
            <View style={styles.patternDetails}>
              <Text style={styles.patternTitle} numberOfLines={1}>
                {pattern.title}
              </Text>
              <Text style={styles.patternMeta}>
                {t('common.patternMeta.dimensionsColors', {
                  width: pattern.width,
                  height: pattern.height,
                  count: pattern.colorsCount,
                })}
              </Text>
            </View>
          </Card>
        ))}
      </ScrollView>

      {/* Staff Picks */}
      <SectionHeader title={t('index.sections.staffPicks')} />
      {staffPicks.isLoading ? (
        <SectionLoading />
      ) : staffPicks.isError ? (
        <SectionError
          error={staffPicks.error}
          fallbackBody={t('index.staffPicks.errorBody')}
          onRetry={() => staffPicks.refetch()}
        />
      ) : (staffPicks.data?.data.length ?? 0) === 0 ? (
        <View style={styles.sectionPadding}>
          <EmptyState
            icon="star-outline"
            title={t('index.staffPicks.emptyTitle')}
            body={t('index.staffPicks.emptyBody')}
          />
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.horizontalScroll}
        >
          {staffPicks.data?.data.map((pattern) => (
            <ServerPatternCard
              key={pattern.id}
              pattern={pattern}
              onPress={() => handleSelectPattern(pattern.id)}
            />
          ))}
        </ScrollView>
      )}

      {/* Categories */}
      <SectionHeader title={t('index.sections.categories')} />
      {categories.isLoading ? (
        <SectionLoading />
      ) : categories.isError ? (
        <SectionError
          error={categories.error}
          fallbackBody={t('index.categories.errorBody')}
          onRetry={() => categories.refetch()}
        />
      ) : (
        <View style={styles.categoryGrid}>
          {categories.data?.data.map((category) => (
            <Card
              key={category.code}
              style={styles.categoryCard}
              onPress={() =>
                router.push(
                  `/(tabs)/(catalog)/browse?category=${category.code}&title=${encodeURIComponent(category.label)}`,
                )
              }
            >
              <Text style={styles.categoryName} numberOfLines={1}>
                {category.label}
              </Text>
              <Text style={styles.categoryCount}>
                {t('index.categories.count', { count: category.count })}
              </Text>
            </Card>
          ))}
        </View>
      )}

      {/* Tag chips */}
      {(tags.data?.data.length ?? 0) > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tagRow}
        >
          {tags.data?.data.map((tag) => (
            <Pressable
              key={tag.code}
              style={({ pressed }) => [styles.tagChip, pressed && styles.tagChipPressed]}
              onPress={() =>
                router.push(
                  `/(tabs)/(catalog)/browse?tag=${tag.code}&title=${encodeURIComponent(tag.label)}`,
                )
              }
            >
              <Text style={styles.tagChipText}>#{tag.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* New Patterns */}
      <SectionHeader title={t('index.sections.newPatterns')} />
      {newPatterns.isLoading ? (
        <SectionLoading />
      ) : newPatterns.isError ? (
        <SectionError
          error={newPatterns.error}
          fallbackBody={t('index.newPatterns.errorBody')}
          onRetry={() => newPatterns.refetch()}
        />
      ) : newItems.length === 0 ? (
        <View style={styles.sectionPadding}>
          <EmptyState
            icon="time-outline"
            title={t('index.newPatterns.emptyTitle')}
            body={t('index.newPatterns.emptyBody')}
          />
        </View>
      ) : (
        <View style={styles.sectionPadding}>
          {newItems.map((pattern) => (
            <NewPatternRow
              key={pattern.id}
              pattern={pattern}
              onPress={() => handleSelectPattern(pattern.id)}
            />
          ))}
          {newPatterns.hasNextPage && (
            <Button
              title={
                newPatterns.isFetchingNextPage
                  ? t('index.newPatterns.loading')
                  : t('index.newPatterns.showMore')
              }
              variant="secondary"
              loading={newPatterns.isFetchingNextPage}
              onPress={() => {
                void newPatterns.fetchNextPage();
              }}
              style={styles.showMoreButton}
            />
          )}
        </View>
      )}
    </Screen>
  );
}

function ServerPatternCard({
  pattern,
  onPress,
}: {
  pattern: CatalogPatternItem;
  onPress: () => void;
}) {
  const { t } = useTranslation('catalog');
  const { data: localLikes } = useLocalLikes();
  const { isAccount } = useIdentityStore();
  const isLiked = isAccount ? pattern.viewerLiked : !!localLikes?.[pattern.id];

  return (
    <Card style={styles.patternCard} onPress={onPress}>
      <PatternImage
        assets={{
          thumbnailUrls: absoluteThumbnailUrls(pattern.thumbnailUrls),
          previewUrl: absolutePreviewUrl(pattern.previewUrl),
        }}
        variant="browsing"
        style={styles.patternImage}
      />
      <View style={styles.patternDetails}>
        <Text style={styles.patternTitle} numberOfLines={1}>
          {pattern.title}
        </Text>
        <SourceLanguageBadge
          sourceLanguage={pattern.sourceLanguage}
          style={styles.sourceLanguageBadge}
        />
        <Text style={styles.patternMeta}>
          {t('common.patternMeta.dimensionsCols', {
            width: pattern.width,
            height: pattern.height,
            count: pattern.paletteSize,
          })}
        </Text>
        <View style={styles.cardLikesRow}>
          <Ionicons
            name={isLiked ? 'heart' : 'heart-outline'}
            size={12}
            color={isLiked ? Theme.colors.error : Theme.colors.textSecondary}
          />
          <Text style={styles.cardLikesText}>{pattern.likeCount}</Text>
        </View>
      </View>
    </Card>
  );
}

function NewPatternRow({
  pattern,
  onPress,
}: {
  pattern: CatalogPatternItem;
  onPress: () => void;
}) {
  const { t } = useTranslation('catalog');
  const { data: localLikes } = useLocalLikes();
  const { isAccount } = useIdentityStore();
  const isLiked = isAccount ? pattern.viewerLiked : !!localLikes?.[pattern.id];

  return (
    <Card style={styles.newRow} onPress={onPress}>
      <PatternImage
        assets={{
          thumbnailUrls: absoluteThumbnailUrls(pattern.thumbnailUrls),
          previewUrl: absolutePreviewUrl(pattern.previewUrl),
        }}
        variant="browsing"
        style={styles.newRowImage}
      />
      <View style={styles.newRowDetails}>
        <View style={styles.newRowHeader}>
          <Text style={styles.patternTitle} numberOfLines={1}>
            {pattern.title}
          </Text>
          <View style={styles.cardLikesRow}>
            <Ionicons
              name={isLiked ? 'heart' : 'heart-outline'}
              size={12}
              color={isLiked ? Theme.colors.error : Theme.colors.textSecondary}
            />
            <Text style={styles.cardLikesText}>{pattern.likeCount}</Text>
          </View>
        </View>
        <SourceLanguageBadge
          sourceLanguage={pattern.sourceLanguage}
          style={styles.sourceLanguageBadge}
        />
        <Text style={styles.patternMeta}>
          {t('common.patternMeta.creatorDimensions', {
            creatorName: pattern.creatorName,
            width: pattern.width,
            height: pattern.height,
          })}
        </Text>
        <View style={styles.newRowTags}>
          {pattern.tags.slice(0, 3).map((tag) => (
            <Text key={tag.code} style={styles.newRowTag}>
              #{tag.label}
            </Text>
          ))}
        </View>
      </View>
    </Card>
  );
}

function SectionLoading() {
  return (
    <View style={styles.sectionLoading}>
      <ActivityIndicator size="small" color={Theme.colors.accentTeal} />
    </View>
  );
}

function SectionError({
  error,
  fallbackBody,
  onRetry,
}: {
  error: unknown;
  fallbackBody: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation('catalog');
  const genericTitle = t('common.sectionError.title');
  const presentation = presentCatalogError(error, {
    genericTitle,
    title: genericTitle,
    body: fallbackBody,
  });
  return (
    <View style={styles.sectionPadding}>
      <EmptyState
        icon="cloud-offline-outline"
        title={presentation.title}
        body={presentation.body}
        actionLabel={t('common.sectionError.retry')}
        onAction={onRetry}
        actionVariant="secondary"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: Theme.spacing.xl,
    paddingBottom: Theme.spacing.xxl,
  },
  header: {
    paddingHorizontal: Theme.spacing.lg,
    marginBottom: Theme.spacing.md,
  },
  appName: {
    fontSize: Theme.typography.sizes.xxxl,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.accentRose,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    marginTop: Theme.spacing.xs,
  },
  searchBar: {
    marginHorizontal: Theme.spacing.lg,
    marginBottom: Theme.spacing.md,
    paddingVertical: Theme.spacing.md,
    paddingHorizontal: Theme.spacing.lg,
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.full,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  searchBarPressed: {
    opacity: 0.7,
  },
  searchBarText: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
  },
  offlineBanner: {
    marginHorizontal: Theme.spacing.lg,
    marginBottom: Theme.spacing.md,
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
  horizontalScroll: {
    paddingHorizontal: Theme.spacing.lg,
    paddingBottom: Theme.spacing.md,
    gap: Theme.spacing.md,
  },
  patternCard: {
    width: 160,
    padding: Theme.spacing.sm,
  },
  patternImage: {
    width: 144,
    height: 144,
    borderRadius: Theme.radii.md,
    backgroundColor: Theme.colors.background,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  patternDetails: {
    marginTop: Theme.spacing.sm,
  },
  patternTitle: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textPrimary,
  },
  sourceLanguageBadge: {
    marginTop: Theme.spacing.xs,
  },
  patternMeta: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    marginTop: Theme.spacing.xs,
  },
  sectionPadding: {
    paddingHorizontal: Theme.spacing.lg,
    marginBottom: Theme.spacing.md,
  },
  sectionLoading: {
    paddingVertical: Theme.spacing.xl,
    alignItems: 'center',
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Theme.spacing.lg,
    gap: Theme.spacing.sm,
    marginBottom: Theme.spacing.md,
  },
  categoryCard: {
    width: '47%',
    padding: Theme.spacing.md,
  },
  categoryName: {
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textPrimary,
  },
  categoryCount: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    marginTop: Theme.spacing.xs,
  },
  tagRow: {
    paddingHorizontal: Theme.spacing.lg,
    gap: Theme.spacing.sm,
    paddingBottom: Theme.spacing.md,
  },
  tagChip: {
    paddingVertical: Theme.spacing.xs,
    paddingHorizontal: Theme.spacing.md,
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.full,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  tagChipPressed: {
    opacity: 0.7,
  },
  tagChipText: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.accentTeal,
    fontWeight: Theme.typography.weights.medium,
  },
  newRow: {
    flexDirection: 'row',
    padding: Theme.spacing.sm,
    marginBottom: Theme.spacing.sm,
  },
  newRowImage: {
    width: 72,
    height: 72,
    borderRadius: Theme.radii.md,
    backgroundColor: Theme.colors.background,
    borderWidth: 1,
    borderColor: Theme.colors.border,
  },
  newRowDetails: {
    flex: 1,
    marginLeft: Theme.spacing.md,
    justifyContent: 'center',
  },
  newRowTags: {
    flexDirection: 'row',
    gap: Theme.spacing.sm,
    marginTop: Theme.spacing.xs,
  },
  newRowTag: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.accentTeal,
  },
  showMoreButton: {
    marginTop: Theme.spacing.sm,
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
  newRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
  },
});
