import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { Screen, EmptyState, SectionHeader } from '@/components';
import { Theme } from '@/theme/theme';
import { Pattern, Category } from '@/types';

export default function CatalogScreen() {
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

  return (
    <Screen scrollable contentContainerStyle={styles.container}>
      {/* Header section with cozy branding */}
      <View style={styles.header}>
        <Text style={styles.appName}>Stitch Wish</Text>
        <Text style={styles.subtitle}>Craft your cozy world, stitch by stitch.</Text>
      </View>

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
  sectionPadding: {
    paddingHorizontal: Theme.spacing.lg,
    marginBottom: Theme.spacing.md,
  },
});
