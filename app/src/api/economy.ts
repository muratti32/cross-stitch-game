import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './apiFetch';

// Unlock prices are fixed by ADR-0011 by tier.
// Note: the server remains authoritative on the actual charge.
export const UNLOCK_PRICE_COIN = {
  small: 75,
  medium: 150,
  large: 300,
} as const;

export type UnlockableTier = 'small' | 'medium' | 'large';

export function unlockPriceForTier(tier: UnlockableTier): number {
  return UNLOCK_PRICE_COIN[tier];
}

export class InsufficientCoinError extends Error {
  constructor(readonly price: number, readonly balance: number) {
    super('insufficient_balance');
    this.name = 'InsufficientCoinError';
  }
}

export interface UnlockResult {
  patternId: string;
  alreadyUnlocked: boolean;
  balance: number;
}

export async function unlockPattern(patternId: string): Promise<UnlockResult> {
  const res = await apiFetch('/v1/economy/unlocks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ patternId }),
  });

  if (res.status === 409) {
    const data = await res.json().catch(() => null);
    const price = data?.price ?? 0;
    const balance = data?.balance ?? 0;
    throw new InsufficientCoinError(price, balance);
  }

  if (!res.ok) {
    throw new Error('Unlock failed: ' + res.status);
  }

  return (await res.json()) as UnlockResult;
}

export async function fetchCoinBalance(): Promise<number> {
  const res = await apiFetch('/v1/economy/balance');
  if (!res.ok) {
    throw new Error('Failed to fetch coin balance: ' + res.status);
  }
  const data = (await res.json()) as { balance: number };
  return data.balance;
}

export async function fetchUnlockedPatternIds(): Promise<string[]> {
  const res = await apiFetch('/v1/economy/unlocks');
  if (!res.ok) {
    throw new Error('Failed to fetch unlocked patterns: ' + res.status);
  }
  const data = (await res.json()) as { patternIds: string[] };
  return data.patternIds;
}

export function useCoinBalance() {
  return useQuery({
    queryKey: ['economy', 'balance'],
    queryFn: fetchCoinBalance,
  });
}

export function useUnlockedPatternIds() {
  return useQuery({
    queryKey: ['economy', 'unlocks'],
    queryFn: fetchUnlockedPatternIds,
  });
}

export function useUnlockPattern() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: unlockPattern,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['economy', 'balance'] });
      queryClient.invalidateQueries({ queryKey: ['economy', 'unlocks'] });
    },
  });
}

export interface RewardDayView {
  balance: number;
  adsRemaining: number;
  coinsRemaining: number;
  resetsAt: string;
  premiumClaimed: boolean;
}

export async function fetchRewardDay(): Promise<RewardDayView> {
  const res = await apiFetch('/v1/economy/reward-day');
  if (!res.ok) {
    throw new Error('Failed to fetch reward day: ' + res.status);
  }
  return (await res.json()) as RewardDayView;
}

export function useRewardDay() {
  return useQuery({
    queryKey: ['economy', 'reward-day'],
    queryFn: fetchRewardDay,
  });
}

export interface AdAttempt {
  nonce: string;
  expiresAt: string;
}

export async function openAdAttempt(): Promise<AdAttempt> {
  const res = await apiFetch('/v1/economy/ad-attempts', {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error('Failed to open ad attempt: ' + res.status);
  }
  return (await res.json()) as AdAttempt;
}

export function useOpenAdAttempt() {
  return useMutation({
    mutationFn: openAdAttempt,
  });
}

export interface AdRewardGrantResult {
  granted: boolean;
  amount: number;
  balance: number;
  adsCompleted: number;
  coinsConsumed: number;
  replayed: boolean;
}

export async function claimAdReward(nonce: string): Promise<AdRewardGrantResult> {
  const res = await apiFetch('/v1/economy/ad-attempts/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nonce }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    const rawMsg = errBody?.message;
    const msg = Array.isArray(rawMsg) ? rawMsg.join(', ') : rawMsg || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return (await res.json()) as AdRewardGrantResult;
}

export function useClaimAdReward() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: claimAdReward,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['economy', 'balance'] });
      queryClient.invalidateQueries({ queryKey: ['economy', 'reward-day'] });
    },
  });
}
