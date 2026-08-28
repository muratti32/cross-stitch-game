import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from './apiFetch';
import type { PurchaseProductKey } from '../analytics/schema';

export type PremiumPlan = 'weekly' | 'monthly' | 'annual';
export type MembershipLifecycle =
  | 'trial'
  | 'active'
  | 'cancelled'
  | 'grace'
  | 'billing_retry'
  | 'paused'
  | 'expired'
  | 'refunded';

export interface MembershipScheduledChange {
  targetPlan: PremiumPlan;
  effectiveAt: string;
}

export interface MembershipView {
  active: boolean;
  plan: PremiumPlan | null;
  lifecycle: MembershipLifecycle | null;
  expiresAt: string | null;
  themeAccess: boolean;
  scheduledChange: MembershipScheduledChange | null;
  dailyClaim: {
    claimed: boolean;
    coinsAvailable: number;
    resetsAt: string;
  };
}

export interface PremiumDailyClaimResult {
  claimed: boolean;
  amount: number;
  balance: number;
  coinsConsumed: number;
  replayed: boolean;
}

export interface PremiumReconciliationReference {
  supportReference: string;
}

// #159/#166: shaped like CreatorProfileApiError, SocialApiError, and
// CatalogSubmissionApiError (06c8eb0) so a caught membership failure routes
// through localizeServerError instead of the server's raw English message.
export class MembershipApiError extends Error {
  constructor(readonly status: number, message: string, readonly reason: string | null) {
    super(message);
    this.name = 'MembershipApiError';
  }
}

async function parseMembershipError(response: Response, fallback: string): Promise<MembershipApiError> {
  let message = fallback;
  let reason: string | null = null;
  try {
    const body = (await response.json()) as { message?: unknown; reason?: unknown };
    if (typeof body.message === 'string') message = body.message;
    if (Array.isArray(body.message)) {
      message = body.message.filter((item): item is string => typeof item === 'string').join(', ');
    }
    if (typeof body.reason === 'string') reason = body.reason;
  } catch {
    // Keep the actionable fallback.
  }
  return new MembershipApiError(response.status, message, reason);
}

export async function createPremiumReconciliation(
  operation: 'purchase' | 'restore',
  productKey: PurchaseProductKey | null,
): Promise<PremiumReconciliationReference> {
  const response = await apiFetch('/v1/commerce/membership/reconciliations', {
    method: 'POST',
    body: JSON.stringify({ operation, productKey }),
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    throw await parseMembershipError(response, `Purchase verification could not be started: ${response.status}`);
  }
  return (await response.json()) as PremiumReconciliationReference;
}

export async function fetchMembership(): Promise<MembershipView> {
  const response = await apiFetch('/v1/commerce/membership');
  if (!response.ok) {
    throw await parseMembershipError(response, `Failed to fetch Premium Membership: ${response.status}`);
  }
  return (await response.json()) as MembershipView;
}

export async function claimPremiumDailyCoin(): Promise<PremiumDailyClaimResult> {
  const response = await apiFetch('/v1/commerce/membership/daily-claim', {
    method: 'POST',
  });
  if (!response.ok) {
    throw await parseMembershipError(
      response,
      response.status === 403
        ? 'An active Premium Membership is required.'
        : `Premium daily claim failed: ${response.status}`,
    );
  }
  return (await response.json()) as PremiumDailyClaimResult;
}

export function useMembership(enabled = true) {
  return useQuery({
    queryKey: ['commerce', 'membership'],
    queryFn: fetchMembership,
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function usePremiumDailyClaim() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: claimPremiumDailyCoin,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commerce', 'membership'] });
      queryClient.invalidateQueries({ queryKey: ['economy', 'reward-day'] });
      queryClient.invalidateQueries({ queryKey: ['economy', 'balance'] });
    },
  });
}
