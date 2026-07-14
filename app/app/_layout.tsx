import { useEffect } from 'react';
import { Slot } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryProvider } from '../src/providers';
import * as SplashScreen from 'expo-splash-screen';

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  useEffect(() => {
    // Hide splash screen since we are using system fonts and are ready
    SplashScreen.hideAsync().catch((err: unknown) => {
      console.warn('Failed to hide splash screen:', err);
    });
  }, []);

  return (
    <SafeAreaProvider>
      <QueryProvider>
        <Slot />
      </QueryProvider>
    </SafeAreaProvider>
  );
}
