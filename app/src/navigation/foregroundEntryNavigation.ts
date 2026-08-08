import type { Href } from 'expo-router';
import {
  ForegroundEntryCoordinator,
  type ForegroundEntryDecision,
  type LifecycleEntryContext,
  type LifecycleStatus,
  type ProtectedRoundTripKind,
} from './foregroundEntryPolicy';

export const CATALOG_TAB_ROOT = '/(tabs)/(catalog)' as Href;

export type ForegroundNavigationRouter = {
  /** Expo Router's tab-level navigate preserves an existing catalog stack. */
  navigate: (href: Href) => void;
};

export const foregroundEntryCoordinator = new ForegroundEntryCoordinator();

export function applyForegroundEntryDecision(
  decision: ForegroundEntryDecision | undefined,
  router: ForegroundNavigationRouter,
  pathname: string,
): void {
  if (decision?.action !== 'select-catalog') return;
  // A return while Catalog is already visible is intentionally idempotent.
  if (pathname.includes('/(catalog)') || pathname.includes('/catalog')) return;
  router.navigate(CATALOG_TAB_ROOT);
}

export function handleForegroundLifecycle(
  nextState: LifecycleStatus,
  context: LifecycleEntryContext,
  router: ForegroundNavigationRouter,
  pathname: string,
): ForegroundEntryDecision | undefined {
  const decision = foregroundEntryCoordinator.onLifecycleChange(nextState, context);
  applyForegroundEntryDecision(decision, router, pathname);
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
    if (!options.keepUntilForeground) {
      foregroundEntryCoordinator.clearProtectedRoundTrip(token.token);
    }
  }
}
