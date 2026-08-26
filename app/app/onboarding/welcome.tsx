import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { BUNDLED_PATTERNS } from '@/bundled-patterns';
import { Button, PatternImage, Screen } from '@/components';
import { setHandedness as persistHandedness } from '@/local-db';
import { saveOnboardingPosition, startTutorial } from '@/onboarding/state';
import { prepareBundledSession } from '@/session-preparation';
import { useGameplayStore } from '@/store/gameplayStore';
import { Theme } from '@/theme/theme';

const STARTER_ID = 'starter_heart';

export default function WelcomeScreen() {
  const router = useRouter();
  const { handedness, setHandedness } = useGameplayStore();
  const [starting, setStarting] = useState(false);
  const starter = BUNDLED_PATTERNS.find((pattern) => pattern.id === STARTER_ID);

  if (!starter) throw new Error('Canonical starter_heart bundled pattern is missing');

  const chooseHandedness = (value: 'left' | 'right') => {
    setHandedness(value);
    void persistHandedness(value).catch((error: unknown) => {
      console.warn('Failed to save onboarding handedness:', error);
    });
  };

  const start = async () => {
    if (starting) return;
    setStarting(true);
    try {
      const session = await prepareBundledSession(starter.id, starter.checksum);
      await startTutorial(session.id);
      router.navigate({
        pathname: '/(tabs)/(play)/[sessionId]',
        params: { sessionId: session.id },
      });
    } finally {
      setStarting(false);
    }
  };

  const browse = async () => {
    await saveOnboardingPosition('deferred');
    router.navigate('/(tabs)/(catalog)');
  };

  return (
    <Screen scrollable contentContainerStyle={styles.container} clearsTabBar={false}>
      <Text style={styles.eyebrow}>WELCOME TO STITCH WISH</Text>
      <Text style={styles.title}>Pick a color, tap the matching squares.</Text>
      <PatternImage
        assets={{}}
        variant="detail"
        localAsset={starter.previewAsset}
        accessibilityLabel="Cozy Heart starter pattern preview"
        style={styles.preview}
      />
      <Text style={styles.sectionTitle}>Which side should the controls use?</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Control side"
        style={styles.segments}
      >
        {(['right', 'left'] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{ selected: handedness === value }}
            onPress={() => chooseHandedness(value)}
            style={[styles.segment, handedness === value && styles.segmentSelected]}
          >
            <Text style={[styles.segmentText, handedness === value && styles.segmentTextSelected]}>
              Controls on the {value}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.note}>You can change this later in Settings.</Text>
      <Button title={starting ? 'Starting…' : 'Start stitching'} onPress={() => void start()} loading={starting} />
      <Button title="Browse starters" variant="secondary" onPress={() => void browse()} />
      <Pressable
        accessibilityRole="link"
        onPress={() => router.navigate({ pathname: '/(tabs)/(settings)/sign-in', params: { returnTo: '/onboarding/welcome' } })}
        style={styles.signIn}
      >
        <Text style={styles.signInText}>Sign in</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, gap: Theme.spacing.lg, padding: Theme.spacing.xl, justifyContent: 'center' },
  eyebrow: { color: Theme.colors.accentRose, fontSize: Theme.typography.sizes.xs, fontWeight: Theme.typography.weights.bold, letterSpacing: 1.4, textAlign: 'center' },
  title: { color: Theme.colors.textPrimary, fontSize: Theme.typography.sizes.xxl, fontWeight: Theme.typography.weights.bold, textAlign: 'center' },
  preview: { alignSelf: 'center', aspectRatio: 1, borderRadius: Theme.radii.xl, maxHeight: 280, width: '82%' },
  sectionTitle: { color: Theme.colors.textPrimary, fontSize: Theme.typography.sizes.md, fontWeight: Theme.typography.weights.semibold, textAlign: 'center' },
  segments: { flexDirection: 'row', gap: Theme.spacing.sm },
  segment: { alignItems: 'center', borderColor: Theme.colors.border, borderRadius: Theme.radii.lg, borderWidth: 2, flex: 1, minHeight: 48, justifyContent: 'center', padding: Theme.spacing.sm },
  segmentSelected: { backgroundColor: Theme.colors.accentHoneySoft, borderColor: Theme.colors.accentTeal },
  segmentText: { color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.sm, fontWeight: Theme.typography.weights.semibold },
  segmentTextSelected: { color: Theme.colors.accentTeal },
  note: { color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.sm, textAlign: 'center' },
  signIn: { alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  signInText: { color: Theme.colors.textSecondary, fontSize: Theme.typography.sizes.sm, textDecorationLine: 'underline' },
});
