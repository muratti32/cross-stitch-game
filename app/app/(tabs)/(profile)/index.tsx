import React, { useState } from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';
import { Screen, EmptyState } from '@/components';
import { Theme } from '@/theme/theme';
import { Ionicons } from '@expo/vector-icons';

export default function ProfileScreen() {
  const [activeTab, setActiveTab] = useState<'my-patterns' | 'liked'>('my-patterns');

  const playerStats = {
    username: 'cozyStitcher',
    displayName: 'Cozy Stitcher',
    coins: 120,
    creationsCount: 0,
    completedCount: 3,
  };

  const handleEditProfile = () => {
    console.log('Editing profile...');
  };

  return (
    <Screen scrollable contentContainerStyle={styles.container}>
      {/* Profile Header Card */}
      <View style={styles.profileCard}>
        <View style={styles.avatarContainer}>
          <Ionicons name="person" size={48} color={Theme.colors.accentRose} />
        </View>
        
        <Text style={styles.displayName}>{playerStats.displayName}</Text>
        <Text style={styles.username}>@{playerStats.username}</Text>
        
        <Pressable onPress={handleEditProfile} style={styles.editButton}>
          <Text style={styles.editButtonText}>Edit Profile</Text>
        </Pressable>
      </View>

      {/* Stats Bar */}
      <View style={styles.statsContainer}>
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{playerStats.coins}</Text>
          <Text style={styles.statLabel}>Stitch Coins</Text>
        </View>
        
        <View style={styles.statDivider} />
        
        <View style={styles.statBox}>
          <Text style={styles.statValue}>{playerStats.completedCount}</Text>
          <Text style={styles.statLabel}>Stitched</Text>
        </View>

        <View style={styles.statDivider} />

        <View style={styles.statBox}>
          <Text style={styles.statValue}>{playerStats.creationsCount}</Text>
          <Text style={styles.statLabel}>Creations</Text>
        </View>
      </View>

      {/* Tab Switcher */}
      <View style={styles.tabBar}>
        <Pressable 
          onPress={() => setActiveTab('my-patterns')}
          style={[styles.tabItem, activeTab === 'my-patterns' && styles.activeTabItem]}
        >
          <Text style={[styles.tabLabel, activeTab === 'my-patterns' && styles.activeTabLabel]}>
            My Creations
          </Text>
        </Pressable>
        
        <Pressable 
          onPress={() => setActiveTab('liked')}
          style={[styles.tabItem, activeTab === 'liked' && styles.activeTabItem]}
        >
          <Text style={[styles.tabLabel, activeTab === 'liked' && styles.activeTabLabel]}>
            Liked Patterns
          </Text>
        </Pressable>
      </View>

      {/* List content / Empty States */}
      <View style={styles.content}>
        {activeTab === 'my-patterns' ? (
          <EmptyState
            icon="color-palette-outline"
            title="No Personal Creations"
            body="You haven't converted any photos or generated AI art yet. Head over to the Create tab to start your first masterwork!"
            actionLabel="Start Creating"
            onAction={() => console.log('Navigating to Create tab...')}
            actionVariant="rose"
          />
        ) : (
          <EmptyState
            icon="heart-outline"
            title="No Liked Patterns"
            body="Browse the pattern catalog and tap the heart icon on any design to save it here for later."
            actionLabel="Discover Patterns"
            onAction={() => console.log('Navigating to Catalog tab...')}
            actionVariant="sage"
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: Theme.spacing.xl,
    paddingHorizontal: Theme.spacing.lg,
    paddingBottom: Theme.spacing.xxl,
  },
  profileCard: {
    alignItems: 'center',
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.lg,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    padding: Theme.spacing.xl,
    marginBottom: Theme.spacing.lg,
  },
  avatarContainer: {
    width: 90,
    height: 90,
    borderRadius: Theme.radii.full,
    backgroundColor: '#FCFAF7',
    borderWidth: 1.5,
    borderColor: Theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Theme.spacing.md,
  },
  displayName: {
    fontSize: Theme.typography.sizes.lg,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  username: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    marginTop: Theme.spacing.xs,
    marginBottom: Theme.spacing.md,
  },
  editButton: {
    paddingVertical: Theme.spacing.sm,
    paddingHorizontal: Theme.spacing.lg,
    borderRadius: Theme.radii.full,
    borderWidth: 1,
    borderColor: Theme.colors.accentTeal,
  },
  editButtonText: {
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.accentTeal,
  },
  statsContainer: {
    flexDirection: 'row',
    backgroundColor: Theme.colors.card,
    borderRadius: Theme.radii.lg,
    borderWidth: 1,
    borderColor: Theme.colors.border,
    paddingVertical: Theme.spacing.md,
    marginBottom: Theme.spacing.xl,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  statBox: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontSize: Theme.typography.sizes.lg,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  statLabel: {
    fontSize: Theme.typography.sizes.xs,
    color: Theme.colors.textSecondary,
    marginTop: Theme.spacing.xs,
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: Theme.colors.border,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1.5,
    borderBottomColor: Theme.colors.border,
    marginBottom: Theme.spacing.lg,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Theme.spacing.md,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  activeTabItem: {
    borderBottomColor: Theme.colors.accentRose,
  },
  tabLabel: {
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.textSecondary,
  },
  activeTabLabel: {
    color: Theme.colors.accentRose,
  },
  content: {
    flex: 1,
  },
});
