import type { Href } from 'expo-router';
import {
  ForegroundEntryCoordinator,
  type ForegroundEntryDecision,
  type LifecycleEntryContext,
  type LifecycleStatus,
  type ProtectedRoundTripKind,
} from './foregroundEntryPolicy';

export const CATALOG_TAB_ROOT = '/(tabs)/(catalog)' as Href;
export const ONBOARDING_WELCOME = '/onboarding/welcome' as Href;

export type ForegroundNavigationRouter = {
  /** Expo Router's tab-level navigate preserves an existing catalog stack. */
  navigate: (href: Href) => void;
};

export const foregroundEntryCoordinator = new ForegroundEntryCoordinator();

export function isApplicationInboundUrl(url: string): boolean {
  return (
    url.startsWith('stitchwish://') ||
    url.startsWith('https://stitchwish.avkdesign.net/')
  );
}

export function isCatalogRoute(segments: readonly string[], pathname = ''): boolean {
  return segments.includes('(catalog)') || pathname.includes('/(catalog)') || pathname.includes('/catalog');
}

/** The play tab's index is the session list; only a concrete child is gameplay. */
export function isActiveStitchingSessionRoute(segments: readonly string[]): boolean {
  const playIndex = segments.indexOf('(play)');
  if (playIndex < 0) return false;
  const child = segments[playIndex + 1];
  return child !== undefined && child !== 'index';
}

export function isRootEntryPrepared(
  databaseReady: boolean,
  onboardingPosition: import('../onboarding/state').OnboardingPosition,
): boolean {
  return databaseReady && onboardingPosition !== 'absent';
}

export function applyForegroundEntryDecision(
  decision: ForegroundEntryDecision | undefined,
  router: ForegroundNavigationRouter,
  pathname: string,
  segments: readonly string[] = [],
): void {
  if (decision?.action === 'select-welcome') {
    if (!pathname.includes('/onboarding/welcome')) router.navigate(ONBOARDING_WELCOME);
    return;
  }
  if (decision?.action !== 'select-catalog') return;
  // A return while Catalog is already visible is intentionally idempotent.
  if (isCatalogRoute(segments, pathname)) return;
  router.navigate(CATALOG_TAB_ROOT);
}

export function handleForegroundLifecycle(
  nextState: LifecycleStatus,
  context: LifecycleEntryContext,
  router: ForegroundNavigationRouter,
  pathname: string,
  segments: readonly string[] = [],
): ForegroundEntryDecision | undefined {
  const decision = foregroundEntryCoordinator.onLifecycleChange(nextState, context);
  applyForegroundEntryDecision(decision, router, pathname, segments);
  return decision;
}

export async function withProtectedRoundTrip<T>(
  kind: ProtectedRoundTripKind,
  operation: () => Promise<T>,
  options: { keepUntilForeground?: boolean } = {},
): Promise<T> {
  const token = foregroundEntryCoordinator.beginProtectedRoundTrip(kind);
  try {
    return await operation();
  } finally {
    if (options.keepUntilForeground === false) {
      foregroundEntryCoordinator.clearProtectedRoundTrip(token.token);
    }
  }
}
