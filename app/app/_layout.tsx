import { useEffect, useState } from 'react';
import { Slot } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryProvider } from '../src/providers';
import * as SplashScreen from 'expo-splash-screen';
import { initDatabase, getHandedness } from '../src/local-db';
import { useGameplayStore } from '../src/store/gameplayStore';

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    async function prepare() {
      try {
        await initDatabase();
        const savedHandedness = await getHandedness();
        useGameplayStore.getState().setHandedness(savedHandedness);
      } catch (e) {
        console.warn('Failed to initialize database:', e);
      } finally {
        setDbReady(true);
        // Hide splash screen since we are using system fonts and are ready
        await SplashScreen.hideAsync().catch((err: unknown) => {
          console.warn('Failed to hide splash screen:', err);
        });
      }
    }
    prepare();
  }, []);

  if (!dbReady) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <QueryProvider>
        <Slot />
      </QueryProvider>
    </SafeAreaProvider>
  );
}
