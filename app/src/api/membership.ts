import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiFetch } from './apiFetch';

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

export interface MembershipView {
  active: boolean;
  plan: PremiumPlan | null;
  lifecycle: MembershipLifecycle | null;
  expiresAt: string | null;
  themeAccess: boolean;
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

export async function fetchMembership(): Promise<MembershipView> {
  const response = await apiFetch('/v1/commerce/membership');
  if (!response.ok) {
    throw new Error(`Failed to fetch Premium Membership: ${response.status}`);
  }
  return (await response.json()) as MembershipView;
}

export async function claimPremiumDailyCoin(): Promise<PremiumDailyClaimResult> {
  const response = await apiFetch('/v1/commerce/membership/daily-claim', {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(
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
