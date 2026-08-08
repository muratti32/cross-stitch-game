import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Linking } from 'react-native';
import { router, Slot, usePathname, useSegments } from 'expo-router';
import * as Sentry from '@sentry/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryProvider } from '../src/providers';
import * as SplashScreen from 'expo-splash-screen';
import { initDatabase, getHandedness } from '../src/local-db';
import { useGameplayStore } from '../src/store/gameplayStore';
import { bootstrap, useIdentityStore } from '../src/identity/guestIdentity';
import { synchronizeRevenueCatIdentity } from '../src/commerce/revenueCat';
import { initializeAdMob } from '../src/ads';
import { initSentry, syncSentryPlayerReferenceWithIdentity } from '../src/observability/sentry';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { syncPendingPersonalPatterns } from '../src/pattern-editor/sync';
import { flushAnalyticsGameplayEvents } from '../src/sync/analyticsGameplayEventEngine';
import {
  handleForegroundLifecycle,
  foregroundEntryCoordinator,
  isActiveStitchingSessionRoute,
} from '../src/navigation/foregroundEntryNavigation';

const ANALYTICS_RETRY_INITIAL_MS = 1_000;
const ANALYTICS_RETRY_MAX_MS = 60_000;
// The app-foreground and startup triggers do the real work; this timer only
// exists so a backlog that built up offline drains while the player keeps
// playing. It is deliberately slow - a fast tick would query SQLite on the
// main thread forever for a queue that is almost always empty.
const ANALYTICS_FLUSH_INTERVAL_MS = 60_000;

// Must run before anything else that could throw.
initSentry();
syncSentryPlayerReferenceWithIdentity();

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

function RootLayout() {
  const [dbReady, setDbReady] = useState(false);
  const pathname = usePathname();
  const segments = useSegments();
  const requiresSignIn = useIdentityStore((state) => state.requiresSignIn);
  const analyticsFlushInFlightRef = useRef(false);
  const analyticsRetryDelayRef = useRef(ANALYTICS_RETRY_INITIAL_MS);
  const analyticsNextRetryAtRef = useRef(0);

  useEffect(() => {
    if (requiresSignIn && !pathname.endsWith('/sign-in')) {
      router.replace('/(tabs)/(settings)/sign-in');
    }
  }, [pathname, requiresSignIn]);

  // This extends the root lifecycle sync trigger already used for pending
  // personal patterns. The retry gate avoids a new reachability subsystem while
  // retrying offline analytics with capped exponential backoff on reconnect.
  const flushAnalytics = useCallback(async () => {
    if (
      analyticsFlushInFlightRef.current ||
      Date.now() < analyticsNextRetryAtRef.current
    ) {
      return;
    }
    analyticsFlushInFlightRef.current = true;
    try {
      await flushAnalyticsGameplayEvents();
      analyticsRetryDelayRef.current = ANALYTICS_RETRY_INITIAL_MS;
      analyticsNextRetryAtRef.current = 0;
    } catch {
      analyticsNextRetryAtRef.current = Date.now() + analyticsRetryDelayRef.current;
      analyticsRetryDelayRef.current = Math.min(
        analyticsRetryDelayRef.current * 2,
        ANALYTICS_RETRY_MAX_MS,
      );
    } finally {
      analyticsFlushInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    const synchronize = (accountId: string | null) => {
      void synchronizeRevenueCatIdentity(accountId).catch((error: unknown) => {
        console.warn(
          'RevenueCat identity synchronization deferred:',
          error instanceof Error ? error.message : String(error),
        );
      });
    };

    synchronize(useIdentityStore.getState().accountId);
    return useIdentityStore.subscribe((state, previousState) => {
      if (state.accountId !== previousState.accountId) {
        synchronize(state.accountId);
      }
    });
  }, []);

  useEffect(() => {
    async function prepare() {
      try {
        await initDatabase();
        const savedHandedness = await getHandedness();
        useGameplayStore.getState().setHandedness(savedHandedness);
        // Trigger lazy guest identity bootstrap in the background (non-blocking)
        bootstrap().catch((err) => {
          console.log('Background identity bootstrap deferred (offline):', err.message);
        });
        // Warm up the AdMob SDK in the background so the first Rewarded Ad
        // request is fast (ADR-0033). No-op on web / when unconfigured.
        initializeAdMob().catch((err: unknown) => {
          console.log(
            'AdMob initialization deferred:',
            err instanceof Error ? err.message : String(err),
          );
        });
        syncPendingPersonalPatterns().catch((err: unknown) => {
          console.log(
            'Pending Personal Pattern sync deferred:',
            err instanceof Error ? err.message : String(err),
          );
        });
        void flushAnalytics();
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
  }, [flushAnalytics]);

  useEffect(() => {
    const inboundSubscription = Linking.addEventListener('url', () => {
      // Native URL delivery can race AppState active; mark it before the
      // foreground coordinator evaluates its ordinary-return default.
      foregroundEntryCoordinator.markInboundNavigationPending();
    });
    const handleAppStateChange = (nextStatus: AppStateStatus) => {
      if (nextStatus === 'active') {
        handleForegroundLifecycle(
          nextStatus,
          {
            requiresSignIn,
            // A mounted session must remain visible through an ordinary return.
            activeStitchingSession: isActiveStitchingSessionRoute(segments),
          },
          router,
          pathname,
          segments,
        );
        syncPendingPersonalPatterns().catch(() => undefined);
        void flushAnalytics();
      }
    };
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      sub.remove();
      inboundSubscription.remove();
    };
  }, [flushAnalytics, pathname, requiresSignIn, segments]);

  useEffect(() => {
    const timer = setInterval(() => {
      void flushAnalytics();
    }, ANALYTICS_FLUSH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [flushAnalytics]);

  if (!dbReady) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryProvider>
          <Slot />
        </QueryProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(RootLayout);
