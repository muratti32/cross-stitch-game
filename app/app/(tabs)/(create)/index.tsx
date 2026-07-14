import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { Screen, Card } from '@/components';
import { Theme } from '@/theme/theme';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

export default function CreateScreen() {
  const router = useRouter();

  const handleNavigate = (path: '/(tabs)/(create)/photo-import' | '/(tabs)/(create)/ai-generation' | '/(tabs)/(create)/pattern-editor') => {
    router.push(path);
  };

  return (
    <Screen scrollable contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Creation Hub</Text>
        <Text style={styles.subtitle}>Bring your own designs to life with custom cross-stitch patterns.</Text>
      </View>

      <View style={styles.cardsContainer}>
        {/* Photo Import Card */}
        <Card
          style={styles.card}
          onPress={() => handleNavigate('/(tabs)/(create)/photo-import')}
        >
          <View style={[styles.iconContainer, { backgroundColor: '#FBECEE' }]}>
            <Ionicons name="image" size={32} color={Theme.colors.accentRose} />
          </View>
          <View style={styles.cardContent}>
            <Text style={styles.cardTitle}>Photo Import</Text>
            <Text style={styles.cardDescription}>
              Upload a picture from your camera roll and convert it into a stitchable pattern.
            </Text>
            <View style={styles.actionRow}>
              <Text style={styles.actionText}>Import photo</Text>
              <Ionicons name="chevron-forward" size={16} color={Theme.colors.accentTeal} />
            </View>
          </View>
        </Card>

        {/* AI Generation Card */}
        <Card
          style={styles.card}
          onPress={() => handleNavigate('/(tabs)/(create)/ai-generation')}
        >
          <View style={[styles.iconContainer, { backgroundColor: '#EBF4EF' }]}>
            <Ionicons name="sparkles" size={30} color={Theme.colors.accentSage} />
          </View>
          <View style={styles.cardContent}>
            <Text style={styles.cardTitle}>AI Generator</Text>
            <Text style={styles.cardDescription}>
              Describe a cozy prompt and let artificial intelligence generate a custom pixel design.
            </Text>
            <View style={styles.actionRow}>
              <Text style={styles.actionText}>Generate design</Text>
              <Ionicons name="chevron-forward" size={16} color={Theme.colors.accentTeal} />
            </View>
          </View>
        </Card>

        {/* Pattern Editor Card */}
        <Card
          style={styles.card}
          onPress={() => handleNavigate('/(tabs)/(create)/pattern-editor')}
        >
          <View style={[styles.iconContainer, { backgroundColor: '#FCFAF0' }]}>
            <Ionicons name="brush" size={30} color={Theme.colors.accentHoney} />
          </View>
          <View style={styles.cardContent}>
            <Text style={styles.cardTitle}>Pattern Editor</Text>
            <Text style={styles.cardDescription}>
              Design custom artwork pixel-by-pixel with standard DMC thread color palettes.
            </Text>
            <View style={styles.actionRow}>
              <Text style={styles.actionText}>Open editor</Text>
              <Ionicons name="chevron-forward" size={16} color={Theme.colors.accentTeal} />
            </View>
          </View>
        </Card>
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
  header: {
    marginBottom: Theme.spacing.xl,
  },
  title: {
    fontSize: Theme.typography.sizes.xxl,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
  },
  subtitle: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    marginTop: Theme.spacing.xs,
  },
  cardsContainer: {
    gap: Theme.spacing.lg,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Theme.spacing.lg,
  },
  iconContainer: {
    width: 60,
    height: 60,
    borderRadius: Theme.radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Theme.spacing.lg,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: Theme.typography.sizes.md,
    fontWeight: Theme.typography.weights.bold,
    color: Theme.colors.textPrimary,
    marginBottom: Theme.spacing.xs,
  },
  cardDescription: {
    fontSize: Theme.typography.sizes.sm,
    color: Theme.colors.textSecondary,
    lineHeight: 18,
    marginBottom: Theme.spacing.sm,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Theme.spacing.xs,
  },
  actionText: {
    fontSize: Theme.typography.sizes.sm,
    fontWeight: Theme.typography.weights.semibold,
    color: Theme.colors.accentTeal,
  },
});
