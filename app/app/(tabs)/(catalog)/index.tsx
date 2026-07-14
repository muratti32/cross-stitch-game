import React from 'react';
import { StyleSheet, View, Text, ScrollView, Image } from 'react-native';
import { Screen, EmptyState, SectionHeader, Card } from '@/components';
import { Theme } from '@/theme/theme';
import { Pattern, Category } from '@/types';
import { BUNDLED_PATTERNS } from '@/bundled-patterns';
import { useRouter } from 'expo-router';

export default function CatalogScreen() {
  const router = useRouter();
  // Hard Rule: Mock-free empty states using strict types
  const staffPicks: Pattern[] = [];
  const newPatterns: Pattern[] = [];
  const categories: Category[] = [];

  const handleRefreshCatalog = () => {
    console.log('Refreshing catalog data...');
  };

  const handleBrowseCategories = () => {
    console.log('Browsing categories...');
  };

  const handleSelectPattern = (id: string) => {
    router.push(`/(tabs)/(catalog)/${id}`);
  };

  return (
    <Screen scrollable contentContainerStyle={styles.container}>
      {/* Header section with cozy branding */}
      <View style={styles.header}>
        <Text style={styles.appName}>Stitch Wish</Text>
        <Text style={styles.subtitle}>Craft your cozy world, stitch by stitch.</Text>
      </View>

      {/* Starter Patterns Section */}
      <SectionHeader title="Starter Patterns" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.starterScrollContainer}
      >
        {BUNDLED_PATTERNS.map((pattern) => (
          <Card
            key={pattern.id}
            style={styles.patternCard}
            onPress={() => handleSelectPattern(pattern.id)}
          >
            <Image source={pattern.previewAsset} style={styles.patternImage} />
            <View style={styles.patternDetails}>
              <Text style={styles.patternTitle} numberOfLines={1}>
                {pattern.title}
              </Text>
              <Text style={styles.patternMeta}>
                {pattern.width}×{pattern.height} • {pattern.colorsCount} colors
              </Text>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{pattern.difficulty.toUpperCase()}</Text>
              </View>
            </View>
          </Card>
        ))}
      </ScrollView>

      {/* Staff Picks Section */}
      <SectionHeader title="Staff Picks" />
      {staffPicks.length === 0 ? (
        <View style={styles.sectionPadding}>
          <EmptyState
            icon="star-outline"
            title="No Staff Picks Yet"
            body="Our hand-picked collection of cozy designs will appear here soon. Keep checking back!"
            actionLabel="Refresh List"
            onAction={handleRefreshCatalog}
            actionVariant="rose"
          />
        </View>
      ) : (
        null // Will render pattern list when API is integrated
      )}

      {/* New Section */}
      <SectionHeader title="New Patterns" />
      {newPatterns.length === 0 ? (
        <View style={styles.sectionPadding}>
          <EmptyState
            icon="time-outline"
            title="New Patterns are Crafting"
            body="Our artists are hard at work designing new cross-stitch patterns. Fresh arrivals are on the way!"
            actionLabel="Refresh List"
            onAction={handleRefreshCatalog}
            actionVariant="sage"
          />
        </View>
      ) : (
        null // Will render pattern list when API is integrated
      )}

      {/* Categories Section */}
      <SectionHeader title="Categories" />
      {categories.length === 0 ? (
        <View style={styles.sectionPadding}>
          <EmptyState
            icon="grid-outline"
            title="No Categories Available"
            body="Categories like Animals, Cozy Home, Flowers, and Retro Gaming will be loaded once available."
            actionLabel="Browse All"
            onAction={handleBrowseCategories}
            actionVariant="honey"
          />
        </View>
      ) : (
        null // Will render categories grid when API is integrated
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: Theme.spacing.xl,
    paddingBottom: Theme.spacing.xxl,
  },
  header: {
    paddingHorizontal: Theme.spacing.lg,
    marginBottom: Theme.spacing.lg,
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
  starterScrollContainer: {
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
    backgroundColor: '#FAF6F0',
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
  patternMeta: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    marginTop: Theme.spacing.xs,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: Theme.colors.overlayPressed,
    paddingHorizontal: Theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: Theme.radii.full,
    marginTop: Theme.spacing.sm,
  },
  badgeText: {
    fontSize: Theme.typography.sizes.xs - 2,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.accentTeal,
  },
  sectionPadding: {
    paddingHorizontal: Theme.spacing.lg,
    marginBottom: Theme.spacing.md,
  },
});

