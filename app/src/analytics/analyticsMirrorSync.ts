import { queryClient } from '../providers';
import { subscribeToOpaquePlayerReference } from '../identity/playerReference';
import { useIdentityStore } from '../identity/guestIdentity';
import { getActiveLocale } from '../i18n';
import type { MembershipView } from '../api/membership';
import {
  setAnalyticsMirrorPlayerReference,
  setAnalyticsMirrorUserProperties,
} from './analyticsMirror';

/**
 * Keeps the Analytics Mirror's identity in step with the app (ADR-0055), so a
 * user seen in the Firebase console can be found in the first-party Gameplay
 * Event stream.
 *
 * The reference is the shared opaque player reference - the Registered Account
 * id, or the Guest Installation Identity - exactly as Sentry receives it. It
 * follows Guest Data Promotion and clears on sign-out. Only three coarse user
 * properties travel with it; anything higher-cardinality belongs in the
 * first-party stream, not here.
 */

const MEMBERSHIP_QUERY_KEY = ['commerce', 'membership'] as const;

function readMembershipTier(): string {
  const membership = queryClient.getQueryData<MembershipView>([...MEMBERSHIP_QUERY_KEY]);
  if (membership === undefined) {
    return 'unknown';
  }
  if (!membership.active) {
    return 'free';
  }
  return membership.plan ?? 'premium';
}

function applyUserProperties(): void {
  setAnalyticsMirrorUserProperties({
    app_language: getActiveLocale(),
    is_guest: useIdentityStore.getState().isAccount ? 'false' : 'true',
    membership_tier: readMembershipTier(),
  });
}

export function syncAnalyticsMirrorIdentity(): void {
  subscribeToOpaquePlayerReference((opaqueId) => {
    setAnalyticsMirrorPlayerReference(opaqueId);
    applyUserProperties();
  });

  // Membership is server-authoritative and arrives asynchronously, so the tier
  // is refreshed whenever its query settles rather than sampled once at boot.
  queryClient.getQueryCache().subscribe((event) => {
    if (event.query.queryKey[0] === MEMBERSHIP_QUERY_KEY[0] &&
        event.query.queryKey[1] === MEMBERSHIP_QUERY_KEY[1]) {
      applyUserProperties();
    }
  });
}
